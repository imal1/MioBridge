import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { toast } from 'sonner'
import { apiService } from '@/lib/api'
import { useConfigSchema, useEffectiveConfig, usePatchConfigValues, useRestoreConfig } from '@/lib/queries'
import type { FrontendConfig } from '@/lib/configApi'
import PageHeader from '@/components/shared/PageHeader'

interface ConfigPageProps {
  initialConfigs?: string[]
  frontendConfig?: Partial<FrontendConfig> | null
  initialError?: string | null
}

interface FieldDefinition {
  path: string
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]'
  restartRequired: boolean
  minimum?: number
  maximum?: number
  allowed?: string[]
}

const FALLBACK_SCHEMA: FieldDefinition[] = [{ path: 'protocols.sing_box_configs', type: 'string[]', restartRequired: false }]
const GROUPS = [
  { key: 'app', label: '应用' }, { key: 'network', label: '网络' }, { key: 'protocols', label: '协议' },
  { key: 'binaries', label: '二进制' }, { key: 'directories', label: '目录' }, { key: 'subscription', label: '订阅' },
  { key: 'deployment', label: '部署' }, { key: 'notifications', label: '通知' }, { key: 'logs', label: '日志' },
] as const

function valueAt(source: Record<string, unknown>, path: string): unknown {
  let value: unknown = source
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    value = (value as Record<string, unknown>)[part]
  }
  return value
}
function setAt(source: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let target = source
  for (const part of parts.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) target[part] = {}
    target = target[part] as Record<string, unknown>
  }
  target[parts.at(-1)!] = value
}
function inputValue(value: unknown, type: FieldDefinition['type']): string {
  if (type.endsWith('[]')) return Array.isArray(value) ? value.join(', ') : ''
  return value === undefined || value === null ? '' : String(value)
}
function parseInput(value: string, field: FieldDefinition): unknown {
  if (field.type === 'number') return Number(value)
  if (field.type === 'number[]') return value.split(',').map(i => Number(i.trim())).filter(Number.isFinite)
  if (field.type === 'string[]') return value.split(',').map(i => i.trim()).filter(Boolean)
  return value
}
function displayError(value: unknown, fallback: string) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') return value.message
  return fallback
}

export default function ConfigPage({ initialConfigs, frontendConfig, initialError = null }: ConfigPageProps = {}) {
  const initialDocument = useMemo<Record<string, unknown>>(() => initialConfigs === undefined ? {} : {
    app: frontendConfig?.app || {}, protocols: { sing_box_configs: initialConfigs },
  }, [frontendConfig, initialConfigs])
  const [schema, setSchema] = useState<FieldDefinition[]>(initialConfigs === undefined ? [] : FALLBACK_SCHEMA)
  const [effective, setEffective] = useState<Record<string, unknown>>(initialDocument)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [configPath, setConfigPath] = useState('')
  const [error, setError] = useState<string | null>(initialError)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [restartPending, setRestartPending] = useState(false)
  const [tab, setTab] = useState<string | null>(null)
  const live = initialConfigs === undefined
  const schemaQuery = useConfigSchema({ enabled: live })
  const effectiveQuery = useEffectiveConfig({ enabled: live })
  const patchConfig = usePatchConfigValues()
  const restoreConfigMutation = useRestoreConfig()

  const applyLoaded = useCallback((fields: FieldDefinition[], config: Record<string, unknown>, path: string) => {
    setSchema(fields); setEffective(config); setConfigPath(path)
    setDraft(Object.fromEntries(fields.map(f => [f.path, inputValue(valueAt(config, f.path), f.type)])))
  }, [])

  useEffect(() => {
    if (!live || !schemaQuery.data || !effectiveQuery.data) return
    applyLoaded(schemaQuery.data as FieldDefinition[], effectiveQuery.data.config, effectiveQuery.data.path)
  }, [live, schemaQuery.data, effectiveQuery.data, applyLoaded])

  useEffect(() => {
    if (initialConfigs !== undefined) setDraft({ 'protocols.sing_box_configs': initialConfigs.join(', ') })
  }, [initialConfigs])

  const loadError = live ? (schemaQuery.error ?? effectiveQuery.error)?.message ?? null : null

  const changes = useMemo(() => schema.flatMap(field => {
    const next = field.type === 'boolean' ? draft[field.path] === 'true' : parseInput(draft[field.path] ?? '', field)
    const before = valueAt(effective, field.path)
    return JSON.stringify(before) === JSON.stringify(next) ? [] : [{ path: field.path, before, after: next, restartRequired: field.restartRequired }]
  }), [draft, effective, schema])
  const dirty = changes.length > 0

  const groupsWithFields = GROUPS.filter(g => schema.some(f => f.path.startsWith(`${g.key}.`)))
  const activeTab = tab && groupsWithFields.some(g => g.key === tab) ? tab : groupsWithFields[0]?.key ?? 'app'
  const tabFields = schema.filter(f => f.path.startsWith(`${activeTab}.`))

  const buildDraftDocument = useCallback(() => {
    const document = structuredClone(effective)
    for (const change of changes) setAt(document, change.path, change.after)
    return document
  }, [changes, effective])

  const validate = useCallback(async () => {
    setError(null); setMessage(null)
    const response = await apiService.validateConfigSource(JSON.stringify(buildDraftDocument(), null, 2))
    if (!response.success || !response.data?.valid) {
      const detail = response.data?.issues.map(i => `${i.path}: ${i.message}`).join('；') || displayError(response.error, '配置校验失败')
      setError(detail); return
    }
    setMessage('当前草稿已通过完整 schema 校验'); toast.success('配置草稿校验通过')
  }, [buildDraftDocument])

  const save = useCallback(async () => {
    if (!changes.length) return
    setSaving(true); setError(null); setMessage(null)
    try {
      const response = await patchConfig.mutateAsync(changes.map(({ path, after }) => ({ path, value: after })))
      if (!response.success || !response.data) throw new Error(displayError(response.error, '配置保存失败'))
      setRestartPending(response.data.restartRequired)
      setMessage(`已在一次原子替换中保存 ${changes.length} 个字段${response.data.restartRequired ? '；部分字段需要重启后生效' : '并生效'}`)
      toast.success('配置已原子保存')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '配置保存失败') }
    finally { setSaving(false) }
  }, [changes, patchConfig])

  const restore = async () => {
    if (!window.confirm('恢复到上一次成功配置？当前配置会保留为 pre-restore 备份。')) return
    setError(null)
    try {
      const response = await restoreConfigMutation.mutateAsync()
      if (!response.success) throw new Error(displayError(response.error, '配置恢复失败'))
      toast.success('已恢复 last-good 配置')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '配置恢复失败') }
  }

  const discard = () => setDraft(Object.fromEntries(schema.map(f => [f.path, inputValue(valueAt(effective, f.path), f.type)])))

  const diffSummary = changes.map(c => `${c.path} ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`).join(' · ')

  return (
    <>
      <PageHeader
        title="配置"
        description={<>Schema 驱动的草稿、差异与单次原子保存。配置路径 <span className="signal-mono" style={{ fontSize: 11.5 }}>{configPath || '~/.config/miobridge/config.yaml'}</span></>}
        actions={(
          <>
            <button onClick={validate} className="mb-pill-btn" style={{ height: 32 }}>校验草稿</button>
            <a href="/api/config/export" download className="mb-pill-btn" style={{ height: 32 }}>导出脱敏配置</a>
            <button onClick={restore} className="mb-pill-btn" style={{ height: 32, color: 'var(--danger)', borderColor: 'var(--danger)' }}>恢复 last-good</button>
          </>
        )}
      />

      {(error ?? loadError) ? (
        <div className="garden-alert garden-alert-danger" style={{ borderRadius: 12, marginBottom: 12 }}>
          <Icon icon="ph:warning-circle-light" className="mt-0.5 size-5 shrink-0" />
          <div><p className="font-semibold">配置操作失败</p><p className="text-xs">{error ?? loadError}</p></div>
        </div>
      ) : null}
      {message ? (
        <div className="garden-alert garden-alert-success" style={{ borderRadius: 12, marginBottom: 12 }}>
          <Icon icon="ph:check-circle-light" className="mt-0.5 size-5 shrink-0" />
          <div><p className="font-semibold">配置结果</p><p className="text-xs">{message}</p></div>
        </div>
      ) : null}
      {restartPending ? (
        <div className="mb-3" style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--warning-bg)', color: 'var(--warning)', fontSize: 12 }}>
          存在待重启字段：文件已安全保存，但相关进程需重启后才会读取新路径或端口。
        </div>
      ) : null}

      <div className="mb-3 flex gap-1" style={{ borderBottom: '1px solid var(--border)' }}>
        {groupsWithFields.map(g => {
          const active = activeTab === g.key
          return (
            <button key={g.key} onClick={() => setTab(g.key)} style={{ height: 32, padding: '0 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: active ? 'var(--primary)' : 'var(--muted-foreground)', borderBottom: `2px solid ${active ? 'var(--primary)' : 'transparent'}`, marginBottom: -1 }}>{g.label}</button>
          )
        })}
      </div>

      <div className="grid gap-2.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {tabFields.map(field => {
          const value = draft[field.path] ?? ''
          const changed = changes.some(c => c.path === field.path)
          const tag = changed ? '已修改' : field.restartRequired ? '需重启' : '可热应用'
          const tagBg = changed ? 'var(--warning-bg)' : field.restartRequired ? 'var(--card2)' : 'var(--success-bg)'
          const tagColor = changed ? 'var(--warning)' : field.restartRequired ? 'var(--muted-foreground)' : 'var(--primary)'
          return (
            <div key={field.path} className="mb-card" style={{ padding: '12px 14px', borderRadius: 12 }}>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="signal-mono" style={{ fontSize: 11.5, fontWeight: 600 }}>{field.path}</span>
                <span style={{ display: 'inline-flex', padding: '1px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: tagBg, color: tagColor }}>{tag}</span>
              </div>
              {field.type === 'boolean' ? (
                <label className="flex items-center gap-2" style={{ fontSize: 12 }}>
                  <input type="checkbox" aria-label={field.path} checked={value === 'true'} onChange={e => setDraft(p => ({ ...p, [field.path]: String(e.target.checked) }))} />启用
                </label>
              ) : field.allowed ? (
                <select aria-label={field.path} value={value} onChange={e => setDraft(p => ({ ...p, [field.path]: e.target.value }))} className="signal-mono" style={{ width: '100%', height: 30, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--card2)', color: 'var(--foreground)', fontSize: 11.5, outline: 'none', boxSizing: 'border-box' }}>
                  {field.allowed.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  aria-label={field.path}
                  type={field.type === 'number' ? 'number' : 'text'}
                  min={field.minimum} max={field.maximum} value={value}
                  placeholder={field.type.endsWith('[]') ? '用逗号分隔多个值' : '未设置'}
                  onChange={e => setDraft(p => ({ ...p, [field.path]: e.target.value }))}
                  className="signal-mono"
                  style={{ width: '100%', height: 30, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--card2)', color: 'var(--foreground)', fontSize: 11.5, outline: 'none', boxSizing: 'border-box' }}
                />
              )}
              <p style={{ margin: '5px 0 0', fontSize: 10.5, color: 'var(--muted-foreground)' }}>生效：{JSON.stringify(valueAt(effective, field.path)) ?? '未设置'}</p>
            </div>
          )
        })}
        {tabFields.length === 0 ? <p style={{ gridColumn: 'span 2', padding: 20, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 12 }}>该分组暂无可编辑字段。</p> : null}
      </div>

      {dirty ? (
        <div className="mb-card mt-[14px] flex items-center justify-between gap-2.5" style={{ padding: '11px 16px' }}>
          <p style={{ margin: 0, fontSize: 12.5 }}><strong>{changes.length} 个待保存差异</strong><span style={{ color: 'var(--muted-foreground)' }}> — {diffSummary}</span></p>
          <div className="flex gap-2">
            <button onClick={discard} className="mb-pill-btn" style={{ height: 30, fontSize: 11.5 }}>放弃草稿</button>
            <button onClick={save} disabled={saving} className="mb-pill-btn primary" style={{ height: 30, fontSize: 11.5 }}>原子保存全部差异</button>
          </div>
        </div>
      ) : null}
    </>
  )
}
