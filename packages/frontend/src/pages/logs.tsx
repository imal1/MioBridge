import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { apiService, type LogsResult } from '@/lib/api'
import { useClusterStatus } from '@/lib/queries'
import PageHeader from '@/components/shared/PageHeader'

type LogSource = 'control' | 'agent' | 'deployment' | 'subscription'

const SOURCES: Array<{ value: LogSource; label: string }> = [
  { value: 'control', label: '控制面' }, { value: 'agent', label: 'Agent' },
  { value: 'deployment', label: '部署任务' }, { value: 'subscription', label: '订阅任务' },
]
const LEVELS = [
  { value: 'all', label: '全部级别' }, { value: 'error', label: 'ERROR' },
  { value: 'warn', label: 'WARN' }, { value: 'info', label: 'INFO' }, { value: 'debug', label: 'DEBUG' },
]
const COMPONENTS = [
  { value: '', label: '全部组件' }, { value: 'agent', label: 'Agent' }, { value: 'mihomo', label: 'mihomo' },
  { value: 'sing-box', label: 'sing-box' }, { value: 'xray', label: 'Xray' }, { value: 'v2ray', label: 'V2Ray' },
]

export function initialLogSource(params: URLSearchParams): LogSource {
  const source = params.get('source')
  if (source === 'control' || source === 'agent' || source === 'deployment' || source === 'subscription') return source
  if (params.get('task')) return 'deployment'
  if (params.get('node')) return 'agent'
  return 'control'
}

const selectStyle: React.CSSProperties = { height: 33, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', color: 'var(--foreground)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }

export default function LogsPage() {
  const [searchParams] = useSearchParams()
  const [logs, setLogs] = useState<LogsResult | null>(null)
  const clusterQuery = useClusterStatus()
  const nodes = clusterQuery.data?.nodes ?? []
  const [source, setSourceState] = useState<LogSource>(() => initialLogSource(searchParams))
  const [nodeId, setNodeId] = useState(searchParams.get('node') || '')
  const [component, setComponent] = useState(searchParams.get('component') || '')
  const [taskId, setTaskId] = useState(searchParams.get('taskId') || searchParams.get('task') || '')
  const [level, setLevel] = useState('all')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const initialLoad = useRef(false)

  const setSource = (value: LogSource) => { setSourceState(value); setLogs(null); setError(null) }
  const taskRequired = source === 'deployment' || source === 'subscription'

  const loadLogs = useCallback(async (notify = true) => {
    if (source === 'agent' && !nodeId) { setError('Agent 日志需要先选择一个节点'); return }
    if (taskRequired && !taskId.trim()) { setError(`${source === 'deployment' ? '部署' : '订阅'}任务日志需要任务 ID`); return }
    setLoading(true); setError(null)
    try {
      const result = await apiService.getLogs(source === 'agent' ? nodeId : undefined, '', level, query, {
        source, ...(component ? { component } : {}), ...(taskId.trim() ? { taskId: taskId.trim() } : {}),
      })
      if (!result.success || !result.data) throw new Error(typeof result.error === 'string' ? result.error : '读取日志失败')
      setLogs(result.data)
      if (notify) toast.success('日志已刷新', { description: `${SOURCES.find(s => s.value === source)?.label} · ${result.data.lines.length} 行` })
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : '读取日志失败'
      setError(msg); if (notify) toast.error('读取日志失败', { description: msg })
    } finally { setLoading(false) }
  }, [component, level, nodeId, query, source, taskId, taskRequired])

  useEffect(() => { if (!nodeId && nodes[0]) setNodeId(nodes[0].nodeId) }, [nodes, nodeId])
  useEffect(() => {
    if (initialLoad.current) return
    initialLoad.current = true
    if (source === 'control' || (source === 'agent' && nodeId) || taskId) void loadLogs(false)
  }, [loadLogs, nodeId, source, taskId])
  useEffect(() => {
    if (!autoRefresh) return
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadLogs(false) }, 5000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, loadLogs])

  const copyLogs = async () => { await navigator.clipboard.writeText(logs?.lines.join('\n') || ''); toast.success('已复制当前日志结果') }
  const exportLogs = () => {
    const blob = new Blob([logs?.lines.join('\n') || ''], { type: 'text/plain;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${source}-${taskId || logs?.nodeId || 'miobridge'}-logs.txt`
    link.click(); URL.revokeObjectURL(link.href)
  }

  const sourceLabel = SOURCES.find(s => s.value === source)?.label || source
  const meta = logs
    ? `${sourceLabel} · ${logs.nodeName || logs.nodeId || '本机'} · ${logs.file || '聚合日志'} · ${logs.lines.length} 行 · ${new Date(logs.updatedAt).toLocaleString('zh-CN')}`
    : `${sourceLabel} · 等待查询`

  return (
    <>
      <PageHeader
        title="日志"
        description="控制面、Agent、部署与订阅任务日志统一查询。"
        actions={(
          <>
            <button onClick={() => setAutoRefresh(v => !v)} className="mb-pill-btn" style={{ height: 32, background: autoRefresh ? 'var(--card2)' : undefined }}>
              <Icon icon={autoRefresh ? 'ph:pause-light' : 'ph:play-light'} />{autoRefresh ? '暂停' : '自动刷新'}
            </button>
            <button onClick={copyLogs} disabled={!logs?.lines.length} className="mb-pill-btn" style={{ height: 32 }}>复制</button>
            <button onClick={exportLogs} disabled={!logs?.lines.length} className="mb-pill-btn" style={{ height: 32 }}>导出</button>
          </>
        )}
      />

      {error ? (
        <div className="garden-alert garden-alert-danger" style={{ borderRadius: 12, marginBottom: 12 }}>
          <Icon icon="ph:warning-circle-light" className="mt-0.5 size-5 shrink-0" />
          <div><p className="font-semibold">日志读取失败</p><p className="text-xs">{error}</p></div>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        <select value={source} onChange={e => setSource(e.target.value as LogSource)} style={selectStyle}>
          {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {source === 'agent' ? (
          <select value={nodeId} onChange={e => setNodeId(e.target.value)} style={selectStyle}>
            <option value="">选择节点</option>
            {nodes.map(n => <option key={n.nodeId} value={n.nodeId}>{n.name} · {n.location || n.nodeId}</option>)}
          </select>
        ) : null}
        {taskRequired ? (
          <input value={taskId} onChange={e => setTaskId(e.target.value)} placeholder={source === 'deployment' ? '部署 taskId' : '订阅 jobId'} autoComplete="off" style={{ ...selectStyle, minWidth: 180 }} />
        ) : null}
        <select value={component} onChange={e => setComponent(e.target.value)} style={selectStyle}>
          {COMPONENTS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={level} onChange={e => setLevel(e.target.value)} style={selectStyle}>
          {LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        <input
          value={query} onChange={e => setQuery(e.target.value)} placeholder="关键词：错误、接口路径或消息内容…" autoComplete="off"
          style={{ flex: 1, minWidth: 220, height: 33, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', color: 'var(--foreground)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />
        <button onClick={() => { void loadLogs() }} disabled={loading} className="mb-pill-btn primary" style={{ height: 33 }}>
          <Icon icon={loading ? 'ph:spinner-light' : 'ph:funnel-light'} className={loading ? 'animate-spin' : ''} />应用过滤
        </button>
      </div>

      <div className="mb-card overflow-hidden" style={{ background: 'var(--terminal)' }}>
        <div className="flex items-center justify-between" style={{ padding: '9px 16px', borderBottom: '1px solid rgba(126,226,168,.14)' }}>
          <span className="signal-mono" style={{ fontSize: 11, color: 'rgba(220,238,224,.6)' }}>{meta}</span>
          <span style={{ display: 'flex', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: 'rgba(220,238,224,.18)' }} />
            <span style={{ width: 8, height: 8, borderRadius: 99, background: 'rgba(220,238,224,.18)' }} />
            <span style={{ width: 8, height: 8, borderRadius: 99, background: '#7ee2a8' }} />
          </span>
        </div>
        <pre className="signal-mono" style={{ margin: 0, padding: '14px 16px', maxHeight: '56vh', overflow: 'auto', fontSize: 11.5, lineHeight: 1.75, color: 'var(--terminal-fg)' }}>
          {logs?.lines.length ? logs.lines.join('\n') : '暂无日志内容'}
        </pre>
      </div>
    </>
  )
}
