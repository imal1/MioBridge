import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { apiService, type LogsResult } from '@/lib/api'
import type { ClusterStatus, NodeStatus } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Select } from '@/components/ui/select'
import SignalPage from '@/components/shared/SignalPage'
import WorkflowRail from '@/components/shared/WorkflowRail'

type LogSource = 'control' | 'agent' | 'deployment' | 'subscription'

const SOURCES: Array<{ value: LogSource; label: string; description: string }> = [
  { value: 'control', label: '控制面', description: '本机 Dashboard 与核心服务日志' },
  { value: 'agent', label: 'Agent', description: '指定子节点 Agent 日志' },
  { value: 'deployment', label: '部署任务', description: '组件部署任务的持久化执行日志' },
  { value: 'subscription', label: '订阅任务', description: '订阅生成任务事件与步骤日志' },
]

const LEVELS = [
  { value: 'all', label: '全部级别' },
  { value: 'error', label: 'ERROR' },
  { value: 'warn', label: 'WARN' },
  { value: 'info', label: 'INFO' },
  { value: 'debug', label: 'DEBUG' },
]

const COMPONENTS = [
  { value: '', label: '全部组件' },
  { value: 'agent', label: 'Agent' },
  { value: 'mihomo', label: 'mihomo' },
  { value: 'sing-box', label: 'sing-box' },
  { value: 'xray', label: 'Xray' },
  { value: 'v2ray', label: 'V2Ray' },
]

export function initialLogSource(params: URLSearchParams): LogSource {
  const source = params.get('source')
  if (source === 'control' || source === 'agent' || source === 'deployment' || source === 'subscription') return source
  if (params.get('task')) return 'deployment'
  if (params.get('node')) return 'agent'
  return 'control'
}

type FiltersProps = {
  suffix: string
  source: LogSource
  setSource: (value: LogSource) => void
  nodes: NodeStatus[]
  nodeId: string
  setNodeId: (value: string) => void
  files: string[]
  file: string
  setFile: (value: string) => void
  component: string
  setComponent: (value: string) => void
  taskId: string
  setTaskId: (value: string) => void
  level: string
  setLevel: (value: string) => void
  from: string
  setFrom: (value: string) => void
  to: string
  setTo: (value: string) => void
  query: string
  setQuery: (value: string) => void
  loading: boolean
  load: () => void
}

function LogFilters(props: FiltersProps) {
  const id = (name: string) => `log-${name}-${props.suffix}`
  const taskRequired = props.source === 'deployment' || props.source === 'subscription'
  return <CardContent className="space-y-4">
    <div className="grid gap-2">
      <Label htmlFor={id('source')}>日志来源</Label>
      <Select id={id('source')} value={props.source} onChange={event => props.setSource(event.target.value as LogSource)}>
        {SOURCES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </Select>
      <p className="text-xs text-muted-foreground">{SOURCES.find(item => item.value === props.source)?.description}</p>
    </div>

    {props.source === 'agent' ? <div className="grid gap-2">
      <Label htmlFor={id('node')}>子节点</Label>
      <Select id={id('node')} value={props.nodeId} onChange={event => props.setNodeId(event.target.value)}>
        <option value="">选择节点</option>
        {props.nodes.map(node => <option key={node.nodeId} value={node.nodeId}>{node.name} · {node.location || node.nodeId}</option>)}
      </Select>
    </div> : null}

    {taskRequired ? <div className="grid gap-2">
      <Label htmlFor={id('task')}>任务 ID</Label>
      <Input id={id('task')} value={props.taskId} onChange={event => props.setTaskId(event.target.value)} placeholder={props.source === 'deployment' ? 'deployment taskId' : 'subscription jobId'} autoComplete="off" />
    </div> : null}

    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
      <div className="grid gap-2">
        <Label htmlFor={id('component')}>组件</Label>
        <Select id={id('component')} value={props.component} onChange={event => props.setComponent(event.target.value)}>
          {COMPONENTS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={id('level')}>级别</Label>
        <Select id={id('level')} value={props.level} onChange={event => props.setLevel(event.target.value)}>
          {LEVELS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
      </div>
    </div>

    {props.files.length ? <div className="grid gap-2">
      <Label htmlFor={id('file')}>日志文件</Label>
      <Select id={id('file')} value={props.file} onChange={event => props.setFile(event.target.value)}>
        <option value="">自动选择</option>
        {props.files.map(item => <option key={item} value={item}>{item}</option>)}
      </Select>
    </div> : null}

    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
      <div className="grid gap-2"><Label htmlFor={id('from')}>开始时间</Label><Input id={id('from')} type="datetime-local" value={props.from} onChange={event => props.setFrom(event.target.value)} /></div>
      <div className="grid gap-2"><Label htmlFor={id('to')}>结束时间</Label><Input id={id('to')} type="datetime-local" value={props.to} onChange={event => props.setTo(event.target.value)} /></div>
    </div>

    <div className="grid gap-2">
      <Label htmlFor={id('query')}>关键词</Label>
      <Input id={id('query')} value={props.query} onChange={event => props.setQuery(event.target.value)} placeholder="错误、接口路径或消息内容…" autoComplete="off" />
    </div>
    <Button className="w-full" onClick={props.load} disabled={props.loading}><Icon icon={props.loading ? 'ph:spinner-light' : 'ph:funnel-light'} className={props.loading ? 'animate-spin' : ''} />应用过滤</Button>
  </CardContent>
}

export default function LogsPage() {
  const [searchParams] = useSearchParams()
  const [logs, setLogs] = useState<LogsResult | null>(null)
  const [nodes, setNodes] = useState<NodeStatus[]>([])
  const [source, setSourceState] = useState<LogSource>(() => initialLogSource(searchParams))
  const [nodeId, setNodeId] = useState(searchParams.get('node') || '')
  const [file, setFile] = useState('')
  const [component, setComponent] = useState(searchParams.get('component') || '')
  const [taskId, setTaskId] = useState(searchParams.get('taskId') || searchParams.get('task') || '')
  const [level, setLevel] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const initialLoad = useRef(false)

  const setSource = (value: LogSource) => {
    setSourceState(value)
    setFile('')
    setLogs(null)
    setError(null)
  }

  const loadLogs = useCallback(async (notify = true) => {
    if (source === 'agent' && !nodeId) {
      setError('Agent 日志需要先选择一个子节点')
      return
    }
    if ((source === 'deployment' || source === 'subscription') && !taskId.trim()) {
      setError(`${source === 'deployment' ? '部署' : '订阅'}任务日志需要任务 ID`)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await apiService.getLogs(source === 'agent' ? nodeId : undefined, file, level, query, {
        source,
        ...(component ? { component } : {}),
        ...(taskId.trim() ? { taskId: taskId.trim() } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      })
      if (!result.success || !result.data) throw new Error(typeof result.error === 'string' ? result.error : '读取日志失败')
      setLogs(result.data)
      if (notify) toast.success('日志已刷新', { description: `${SOURCES.find(item => item.value === source)?.label} · ${result.data.lines.length} 行` })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '读取日志失败'
      setError(message)
      if (notify) toast.error('读取日志失败', { description: message })
    } finally {
      setLoading(false)
    }
  }, [component, file, from, level, nodeId, query, source, taskId, to])

  useEffect(() => {
    apiService.getClusterStatus().then(result => {
      if (!result.success) return
      const childNodes = (result.data as ClusterStatus).nodes || []
      setNodes(childNodes)
      if (!nodeId && childNodes[0]) setNodeId(childNodes[0].nodeId)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (initialLoad.current) return
    initialLoad.current = true
    if (source === 'control' || (source === 'agent' && nodeId) || taskId) void loadLogs(false)
  }, [loadLogs, nodeId, source, taskId])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = window.setInterval(() => { void loadLogs(false) }, 5000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, loadLogs])

  const copyLogs = async () => {
    await navigator.clipboard.writeText(logs?.lines.join('\n') || '')
    toast.success('已复制当前日志结果')
  }
  const exportLogs = () => {
    const blob = new Blob([logs?.lines.join('\n') || ''], { type: 'text/plain;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${source}-${taskId || logs?.nodeId || 'miobridge'}-${logs?.file || 'logs'}`
    link.click()
    URL.revokeObjectURL(link.href)
  }
  const filterProps = { source, setSource, nodes, nodeId, setNodeId, files: logs?.files || [], file, setFile, component, setComponent, taskId, setTaskId, level, setLevel, from, setFrom, to, setTo, query, setQuery, loading, load: () => { void loadLogs() } }
  const sourceLabel = SOURCES.find(item => item.value === source)?.label || source

  return <SignalPage
    crumb="Diagnostics stream"
    title="日志"
    description="统一查询控制面、Agent、部署任务和订阅任务日志，并按节点、组件、任务、级别与时间定位问题。"
    status={logs ? `${sourceLabel} · ${logs.lines.length} 行` : `${sourceLabel} · 等待查询`}
    maxWidth="narrow"
    actions={<><Button variant={autoRefresh ? 'default' : 'outline'} onClick={() => setAutoRefresh(value => !value)}><Icon icon={autoRefresh ? 'ph:pause-light' : 'ph:play-light'} />{autoRefresh ? '暂停自动刷新' : '自动刷新'}</Button><Button variant="outline" onClick={copyLogs} disabled={!logs?.lines.length}>复制</Button><Button variant="outline" onClick={exportLogs} disabled={!logs?.lines.length}>导出</Button><Button variant="outline" onClick={() => { void loadLogs() }} disabled={loading}><Icon icon={loading ? 'ph:spinner-light' : 'ph:arrow-clockwise-light'} className={loading ? 'animate-spin' : ''} />刷新日志</Button></>}
  >
    <WorkflowRail current="logs" />
    {error ? <Alert variant="destructive"><Icon icon="ph:warning-circle-bold" className="h-5 w-5" /><div><AlertTitle>日志读取失败</AlertTitle><AlertDescription>{error}</AlertDescription></div></Alert> : null}

    <Card className="min-h-0 md:min-h-[72vh]">
      <div className="md:hidden">
        <CardHeader><CardTitle className="text-xl">过滤日志</CardTitle><CardDescription>选择来源后组合条件查询。</CardDescription></CardHeader>
        <LogFilters {...filterProps} suffix="mobile" />
        <div className="border-t border-[var(--border)]"><LogStream logs={logs} sourceLabel={sourceLabel} /></div>
      </div>
      <div className="hidden md:block">
        <ResizablePanelGroup direction="horizontal" className="min-h-0 rounded-[24px] md:min-h-[72vh]">
          <ResizablePanel defaultSize={32} minSize={26}><CardHeader><CardTitle className="text-xl">过滤日志</CardTitle><CardDescription>选择来源后组合条件查询。</CardDescription></CardHeader><LogFilters {...filterProps} suffix="desktop" /></ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={68} minSize={44}><LogStream logs={logs} sourceLabel={sourceLabel} /></ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </Card>
  </SignalPage>
}

function LogStream({ logs, sourceLabel }: { logs: LogsResult | null; sourceLabel: string }) {
  return <><CardHeader><CardTitle className="text-xl">日志流</CardTitle><CardDescription>{logs ? `${sourceLabel} · ${logs.nodeName || logs.nodeId || '本机'} · ${logs.file || '聚合日志'} · ${logs.lines.length} 行 · ${new Date(logs.updatedAt).toLocaleString('zh-CN')}` : '设置过滤条件后读取日志'}</CardDescription></CardHeader><CardContent><pre className="signal-terminal max-h-[58vh] overflow-auto p-4 font-mono text-[11px] leading-5 md:max-h-[60vh] md:p-5 md:text-xs md:leading-6">{logs?.lines.length ? logs.lines.join('\n') : '暂无日志内容'}</pre></CardContent></>
}
