import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { toast } from 'sonner'
import { apiService } from '@/lib/api'
import type { FrontendConfig } from '@/lib/configApi'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import SignalPage from '@/components/shared/SignalPage'

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
  if (field.type === 'number[]') return value.split(',').map(item => Number(item.trim())).filter(Number.isFinite)
  if (field.type === 'string[]') return value.split(',').map(item => item.trim()).filter(Boolean)
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
  const [initial, setInitial] = useState<Record<string, unknown>>(structuredClone(initialDocument))
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [configPath, setConfigPath] = useState('')
  const [importSource, setImportSource] = useState('')
  const [importDiff, setImportDiff] = useState<Array<{ path: string; before: unknown; after: unknown }>>([])
  const [error, setError] = useState<string | null>(initialError)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [restartPending, setRestartPending] = useState(false)
  const [notificationHistory, setNotificationHistory] = useState<Array<{ id: string; event: string; ok: boolean; statusCode: number; timestamp: string }>>([])

  const applyLoaded = useCallback((fields: FieldDefinition[], config: Record<string, unknown>, path: string) => {
    setSchema(fields); setEffective(config); setInitial(structuredClone(config)); setConfigPath(path)
    setDraft(Object.fromEntries(fields.map(field => [field.path, inputValue(valueAt(config, field.path), field.type)])))
  }, [])

  const refresh = useCallback(async () => {
    const [schemaResponse, configResponse] = await Promise.all([apiService.getConfigSchema(), apiService.getEffectiveConfig()])
    if (!schemaResponse.success || !schemaResponse.data || !configResponse.success || !configResponse.data) throw new Error('配置 schema 或生效值加载失败')
    applyLoaded(schemaResponse.data.fields as FieldDefinition[], configResponse.data.config, configResponse.data.path)
  }, [applyLoaded])

  useEffect(() => {
    if (initialConfigs !== undefined) {
      setDraft({ 'protocols.sing_box_configs': initialConfigs.join(', ') })
      return
    }
    refresh().catch(caught => setError(caught instanceof Error ? caught.message : '配置加载失败'))
  }, [initialConfigs, refresh])

  const changes = useMemo(() => schema.flatMap(field => {
    const next = field.type === 'boolean' ? draft[field.path] === 'true' : parseInput(draft[field.path] ?? '', field)
    const before = valueAt(effective, field.path)
    return JSON.stringify(before) === JSON.stringify(next) ? [] : [{ path: field.path, before, after: next, restartRequired: field.restartRequired }]
  }), [draft, effective, schema])
  const dirty = changes.length > 0
  const defaultGroup = GROUPS.find(group => schema.some(field => field.path.startsWith(`${group.key}.`)))?.key ?? 'app'

  const buildDraftDocument = useCallback(() => {
    const document = structuredClone(effective)
    for (const change of changes) setAt(document, change.path, change.after)
    return document
  }, [changes, effective])

  const validate = useCallback(async () => {
    setError(null); setMessage(null)
    const response = await apiService.validateConfigSource(JSON.stringify(buildDraftDocument(), null, 2))
    if (!response.success || !response.data?.valid) {
      const detail = response.data?.issues.map(issue => `${issue.path}: ${issue.message}`).join('；') || displayError(response.error, '配置校验失败')
      setError(detail); return
    }
    setMessage('当前草稿已通过完整 schema 校验'); toast.success('配置草稿校验通过')
  }, [buildDraftDocument])

  const save = useCallback(async () => {
    if (!changes.length) return
    setSaving(true); setError(null); setMessage(null)
    try {
      const response = await apiService.patchConfigValues(changes.map(({ path, after }) => ({ path, value: after })))
      if (!response.success || !response.data) throw new Error(displayError(response.error, '配置保存失败'))
      setRestartPending(response.data.restartRequired)
      setMessage(`已在一次原子替换中保存 ${changes.length} 个字段${response.data.restartRequired ? '；部分字段需要重启 Dashboard 后生效' : '并生效'}`)
      toast.success('配置已原子保存')
      if (initialConfigs === undefined) await refresh()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '配置保存失败') }
    finally { setSaving(false) }
  }, [changes, initialConfigs, refresh])

  const restore = async () => {
    if (!window.confirm('恢复到上一次成功配置？当前配置会保留为 pre-restore 备份。')) return
    const response = await apiService.restoreConfig()
    if (!response.success) return setError(displayError(response.error, '配置恢复失败'))
    toast.success('已恢复 last-good 配置')
    await refresh()
  }

  const previewImport = async () => {
    setError(null); setImportDiff([])
    const response = await apiService.previewConfigImport(importSource)
    if (!response.success && !response.data) return setError(displayError(response.error, '导入文件无效'))
    const data = response.data as { validation?: { valid: boolean; issues: Array<{ path: string; message: string }> }; differences?: Array<{ path: string; before: unknown; after: unknown }> } | undefined
    if (!data?.validation?.valid) return setError(data?.validation?.issues.map(item => `${item.path}: ${item.message}`).join('；') || '导入文件无效')
    setImportDiff(data.differences || [])
  }

  const testWebhook = async () => {
    setError(null)
    try {
      const response = await apiService.testWebhook()
      if (!response.success || !response.data) throw new Error(displayError(response.error, 'Webhook 测试失败'))
      toast.success('Webhook 测试发送成功', { description: `HTTP ${response.data.statusCode}` })
      const history = await apiService.getNotificationHistory()
      if (history.success && history.data) setNotificationHistory(history.data.records)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Webhook 测试失败') }
  }

  const renderField = (field: FieldDefinition) => {
    const value = draft[field.path] ?? ''
    const changed = changes.some(change => change.path === field.path)
    return <div key={field.path} className="rounded-2xl border border-[var(--border)] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor={`field-${field.path}`}>{field.path}</Label><div className="flex gap-2">{field.restartRequired ? <Badge variant="outline">需重启</Badge> : <Badge variant="secondary">可热应用</Badge>}{changed ? <Badge>已修改</Badge> : null}</div></div><p className="mt-1 text-xs text-muted-foreground">初始：{JSON.stringify(valueAt(initial, field.path)) ?? '未设置'} · 生效：{JSON.stringify(valueAt(effective, field.path)) ?? '未设置'}</p><div className="mt-3">{field.type === 'boolean' ? <label className="flex items-center gap-2 text-sm"><input id={`field-${field.path}`} type="checkbox" checked={value === 'true'} onChange={event => setDraft(previous => ({ ...previous, [field.path]: String(event.target.checked) }))} />启用</label> : field.allowed ? <Select id={`field-${field.path}`} value={value} onChange={event => setDraft(previous => ({ ...previous, [field.path]: event.target.value }))}>{field.allowed.map(option => <option key={option} value={option}>{option}</option>)}</Select> : <Input id={`field-${field.path}`} type={field.type === 'number' ? 'number' : 'text'} min={field.minimum} max={field.maximum} value={value} placeholder={field.type.endsWith('[]') ? '用逗号分隔多个值' : '未设置'} onChange={event => setDraft(previous => ({ ...previous, [field.path]: event.target.value }))} />}</div></div>
  }

  return <SignalPage crumb="Configuration workspace" title="配置" description="由 Core schema 驱动草稿、字段差异、完整校验、单次原子保存、待重启反馈、恢复和导入预览。" status={dirty ? `${changes.length} 个待保存字段` : restartPending ? '配置已保存，等待重启' : '草稿与生效值一致'} maxWidth="narrow" actions={<><Button variant="outline" onClick={validate}><Icon icon="ph:shield-check-light" />校验草稿</Button><Button variant="outline" onClick={refresh} disabled={initialConfigs !== undefined}><Icon icon="ph:arrow-clockwise-light" />刷新</Button></>}>
    {error ? <Alert variant="destructive"><AlertTitle>配置操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    {message ? <Alert variant="success"><AlertTitle>配置结果</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}
    {restartPending ? <Alert><AlertTitle>存在待重启字段</AlertTitle><AlertDescription>文件已经安全保存，但相关进程需要重启后才会读取新路径或端口。</AlertDescription></Alert> : null}
    <div className="grid gap-5 md:grid-cols-3"><Card variant="elevated"><CardHeader><CardDescription>Schema 字段</CardDescription><CardTitle className="signal-value">{schema.length}</CardTitle></CardHeader></Card><Card variant="elevated"><CardHeader><CardDescription>待保存差异</CardDescription><CardTitle className="signal-value">{changes.length}</CardTitle></CardHeader></Card><Card variant="elevated"><CardHeader><CardDescription>配置路径</CardDescription><CardTitle className="break-all text-sm">{configPath || '测试初始值'}</CardTitle></CardHeader></Card></div>
    <Card className="mt-5"><CardHeader><CardTitle>Schema 配置工作台</CardTitle><CardDescription>未出现在 schema 中的字段不能从 CLI 或 Dashboard 修改。</CardDescription></CardHeader><CardContent><Tabs key={defaultGroup} defaultValue={defaultGroup}><TabsList className="flex flex-wrap">{GROUPS.filter(group => schema.some(field => field.path.startsWith(`${group.key}.`))).map(group => <TabsTrigger key={group.key} value={group.key}>{group.label}</TabsTrigger>)}</TabsList>{GROUPS.map(group => <TabsContent key={group.key} value={group.key} className="grid gap-3 md:grid-cols-2">{schema.filter(field => field.path.startsWith(`${group.key}.`)).map(renderField)}</TabsContent>)}</Tabs></CardContent></Card>
    {dirty ? <Card className="mt-5"><CardHeader><CardTitle>字段差异</CardTitle><CardDescription>所有变更通过完整校验后一次写入临时文件，再原子替换生效配置。</CardDescription></CardHeader><CardContent className="space-y-3">{changes.map(change => <div key={change.path} className="rounded-2xl bg-[var(--surface-container)] p-4"><p className="font-medium">{change.path}</p><p className="mt-2 break-all text-xs text-muted-foreground">{JSON.stringify(change.before)} → {JSON.stringify(change.after)}</p></div>)}<div className="flex gap-2"><Button onClick={save} disabled={saving}><Icon icon={saving ? 'ph:spinner-bold' : 'ph:floppy-disk-light'} className={saving ? 'animate-spin' : ''} />原子保存全部差异</Button><Button variant="outline" onClick={() => setDraft(Object.fromEntries(schema.map(field => [field.path, inputValue(valueAt(effective, field.path), field.type)])))}>放弃草稿</Button></div></CardContent></Card> : null}
    <Card className="mt-5"><CardHeader><CardTitle>导入、导出与恢复</CardTitle><CardDescription>导入只生成校验与差异预览，不会直接覆盖；导出内容由服务端脱敏。</CardDescription></CardHeader><CardContent className="space-y-4"><Textarea value={importSource} onChange={event => setImportSource(event.target.value)} rows={8} placeholder="粘贴 YAML 配置，仅执行预览" /><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={previewImport} disabled={!importSource.trim()}>预览导入差异</Button><Button asChild variant="outline"><a href="/api/config/export" download><Icon icon="ph:download-simple-light" />导出脱敏配置</a></Button><Button variant="destructive" onClick={restore}>恢复 last-good</Button></div>{importDiff.length ? <div className="space-y-2">{importDiff.map(item => <div key={item.path} className="rounded-2xl bg-[var(--surface-container)] p-3 text-sm"><strong>{item.path}</strong><p className="mt-1 break-all text-xs text-muted-foreground">{JSON.stringify(item.before)} → {JSON.stringify(item.after)}</p></div>)}</div> : null}</CardContent></Card>
    <Card className="mt-5"><CardHeader><CardTitle>Webhook 通知</CardTitle><CardDescription>Webhook 的启用状态、URL 和事件范围在上方 schema 中保存；此处只发送测试并查看最近结果。</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex gap-2"><Button variant="outline" onClick={testWebhook}>发送测试通知</Button><Button variant="outline" onClick={async () => { const response = await apiService.getNotificationHistory(); if (response.success && response.data) setNotificationHistory(response.data.records) }}>刷新历史</Button></div>{notificationHistory.map(record => <div key={record.id} className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--surface-container)] p-3"><div><p className="font-medium">{record.event}</p><p className="text-xs text-muted-foreground">{new Date(record.timestamp).toLocaleString('zh-CN')} · HTTP {record.statusCode}</p></div><Badge variant={record.ok ? 'secondary' : 'destructive'}>{record.ok ? '成功' : '失败'}</Badge></div>)}{notificationHistory.length === 0 ? <p className="text-sm text-muted-foreground">尚未加载通知投递历史。</p> : null}</CardContent></Card>
  </SignalPage>
}
