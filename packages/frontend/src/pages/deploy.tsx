import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '@iconify/react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { apiService } from '@/lib/api'
import { streamServerEvents } from '@/lib/sse'
import {
  queryKeys, useClusterStatus, useClusterHealthCheck, useComponentDeployments, useComponentStates,
  useCancelDeployment, useRetryDeployment, useStartDeployment,
} from '@/lib/queries'
import type { ComponentDeployStatus, DeployComponent, DeployOperation, NodeStatus } from '@/lib/types'
import { QueryBoundary } from '@/components/shared/QueryBoundary'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Select } from '@/components/ui/select'
import SignalPage from '@/components/shared/SignalPage'

const COMPONENTS: Array<{ value: DeployComponent; label: string; description: string; icon: string }> = [
  { value: 'agent', label: 'Agent', description: '监控、健康、来源与日志 API', icon: 'ph:heartbeat-light' },
  { value: 'mihomo', label: 'mihomo', description: 'CLI 转换器与产物验证', icon: 'ph:arrows-left-right-light' },
  { value: 'sing-box', label: 'sing-box', description: 'sing-box 协议核心与来源', icon: 'ph:cube-light' },
  { value: 'xray', label: 'Xray', description: 'Xray 协议核心与来源', icon: 'ph:cube-light' },
  { value: 'v2ray', label: 'V2Ray', description: 'V2Ray 协议核心与来源', icon: 'ph:cube-light' },
]

const OPERATIONS: Array<{ value: DeployOperation; label: string; description: string }> = [
  { value: 'install', label: '安装', description: '下载、校验、安装、配置并健康检查' },
  { value: 'reinstall', label: '重新安装', description: '覆盖程序并重新校验现有配置' },
  { value: 'upgrade', label: '升级', description: '使用当前默认安装来源升级' },
  { value: 'repair', label: '修复', description: '修复二进制、权限、服务、配置引用与健康状态' },
  { value: 'uninstall', label: '卸载', description: '停止服务并按所选策略保留或删除数据' },
]

const STEP_LABELS: Record<string, string> = {
  queued: '排队', prechecking: '预检', downloading: '下载', verifying_package: '校验包', installing: '安装',
  configuring: '配置', restarting: '重启', postchecking: '健康检查', done: '完成',
}

const STATE_LABELS = {
  installState: '安装态', runtimeState: '运行态', monitorState: '监控态',
} as const

function errorMessage(value: unknown, fallback: string) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') return value.message
  return fallback
}

function taskBadge(task: ComponentDeployStatus) {
  if (task.status === 'success') return <Badge variant="secondary">成功</Badge>
  if (task.status === 'error') return <Badge variant="destructive">失败</Badge>
  if (task.status === 'cancelled') return <Badge variant="outline">已取消</Badge>
  return <Badge>{task.status === 'pending' ? '排队中' : '执行中'}</Badge>
}

interface DeploymentEvent {
  eventId: string
  taskId: string
  step: string
  status: string
  message: string
  progress: number
  timestamp: string
}

// 事件时间线随会话保留：刷新后既要还原已经看到的事件，也要拿到续传用的 Last-Event-ID。
const TIMELINE_STORAGE_KEY = 'miobridge:deployment-events'

function readStoredTimeline(): Record<string, DeploymentEvent[]> {
  try {
    const raw = window.sessionStorage.getItem(TIMELINE_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed as Record<string, DeploymentEvent[]> : {}
  } catch { return {} }
}

function writeStoredTimeline(timeline: Record<string, DeploymentEvent[]>) {
  try { window.sessionStorage.setItem(TIMELINE_STORAGE_KEY, JSON.stringify(timeline)) } catch { /* 存储不可用时仅丢失续传能力 */ }
}

function installed(node: NodeStatus, component: DeployComponent) {
  if (component === 'agent') return Boolean(node.agent?.deployed)
  if (component === 'mihomo') return Boolean(node.mihomoAvailable)
  return Boolean(node.kernels.find(kernel => kernel.type === component)?.detected)
}

export default function DeployPage() {
  const [searchParams] = useSearchParams()
  const requestedComponent = searchParams.get('component') as DeployComponent | null
  const requestedOperation = searchParams.get('operation') as DeployOperation | null
  const queryClient = useQueryClient()
  // SSE 实时更新，轮询 4s 兜底；tab 隐藏时暂停轮询以省请求。
  const pollOptions = { refetchInterval: 4000, refetchIntervalInBackground: false } as const
  const clusterQuery = useClusterStatus(pollOptions)
  const deploymentsQuery = useComponentDeployments(undefined, pollOptions)
  const statesQuery = useComponentStates(undefined, pollOptions)
  const cluster = clusterQuery.data ?? null
  const tasks = deploymentsQuery.data ?? {}
  const states = statesQuery.data ?? []
  const startDeployment = useStartDeployment()
  const retryDeployment = useRetryDeployment()
  const cancelDeployment = useCancelDeployment()
  const healthCheck = useClusterHealthCheck()
  const [selectedNode, setSelectedNode] = useState(searchParams.get('node') || '')
  const [component, setComponent] = useState<DeployComponent>(COMPONENTS.some(item => item.value === requestedComponent) ? requestedComponent! : 'agent')
  const [operation, setOperation] = useState<DeployOperation>(OPERATIONS.some(item => item.value === requestedOperation) ? requestedOperation! : 'install')
  const [preserveConfig, setPreserveConfig] = useState(true)
  const [preserveData, setPreserveData] = useState(true)
  const [manualOpen, setManualOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [preflighting, setPreflighting] = useState(false)
  const [blockedNodes, setBlockedNodes] = useState<Record<string, string[]>>({})
  const [timeline, setTimeline] = useState<Record<string, DeploymentEvent[]>>(readStoredTimeline)
  const [error, setError] = useState<string | null>(null)

  // 订阅副作用必须读到最新的时间线来计算 Last-Event-ID，但不能因为收到事件就重连。
  const timelineRef = useRef(timeline)
  const appendEvent = useCallback((taskId: string, event: DeploymentEvent) => {
    setTimeline(previous => {
      const known = previous[taskId] ?? []
      if (known.some(item => item.eventId === event.eventId)) return previous
      const next = { ...previous, [taskId]: [...known, event] }
      timelineRef.current = next
      writeStoredTimeline(next)
      return next
    })
  }, [])

  // queryClient 身份稳定，refresh 因此稳定：SSE 副作用不会因刷新回调变化而反复重连。
  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.clusterStatus }),
      queryClient.invalidateQueries({ queryKey: queryKeys.componentDeployments() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.componentStates() }),
    ])
  }, [queryClient])

  const nodes = useMemo(() => cluster?.nodes || [], [cluster?.nodes])
  const taskList = useMemo(() => Object.values(tasks).sort((a, b) => b.startedAt - a.startedAt), [tasks])
  const activeTasks = useMemo(() => taskList.filter(task => task.status === 'running' || task.status === 'pending'), [taskList])
  const currentState = states.find(item => item.nodeId === selectedNode && item.component === component)
  const latestEvents = taskList[0] ? timeline[taskList[0].taskId] ?? [] : []
  const node = nodes.find(item => item.nodeId === selectedNode)

  useEffect(() => {
    if (!selectedNode && nodes[0]) setSelectedNode(nodes[0].nodeId)
  }, [nodes, selectedNode])

  useEffect(() => {
    const controllers = activeTasks.map(task => {
      const controller = new AbortController()
      // 刷新后从已记录的最后一条事件继续订阅，避免重放整段历史。
      const lastEventId = timelineRef.current[task.taskId]?.at(-1)?.eventId
      streamServerEvents(`/api/deployments/${encodeURIComponent(task.taskId)}/events`, {
        ...(lastEventId ? { lastEventId } : {}),
        signal: controller.signal,
        onMessage: message => {
          if (message.event !== 'progress') return
          try { appendEvent(task.taskId, JSON.parse(message.data) as DeploymentEvent) } catch { /* 忽略无法解析的帧 */ }
          refresh().catch(() => {})
        },
      }).catch(() => {})
      return controller
    })
    return () => controllers.forEach(controller => controller.abort())
  }, [activeTasks.map(task => task.taskId).join(','), appendEvent, refresh])

  const preflight = useCallback(async () => {
    if (!selectedNode) return
    setPreflighting(true)
    setError(null)
    try {
      const response = await apiService.preflightDeployment(selectedNode, component, operation)
      if (!response.success) throw new Error(errorMessage(response.error, 'SSH 预检失败'))
      const failed = response.data?.checks.filter(check => !check.ok) ?? []
      // 预检结论必须成为创建任务的 gate；本机节点由后端改为直接执行检查。
      setBlockedNodes(previous => ({ ...previous, [selectedNode]: failed.map(item => item.label) }))
      if (failed.length) toast.warning('预检完成，存在阻断项', { description: failed.map(item => item.label).join('、') })
      else toast.success(node?.nodeId === 'local' ? '本机预检通过' : 'SSH 预检通过', { description: `${response.data?.architecture || '未知架构'} · systemd 可用` })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'SSH 预检失败'
      setError(message)
    } finally { setPreflighting(false) }
  }, [component, node?.nodeId, operation, selectedNode])

  const blocking = blockedNodes[selectedNode] ?? []

  const submit = useCallback(async () => {
    if (!selectedNode) return setError('请选择一个目标节点')
    const blocked = blockedNodes[selectedNode] ?? []
    if (blocked.length) return setError(`SSH 预检存在阻断项，请先修复后再创建任务：${blocked.join('、')}`)
    setSubmitting(true)
    setError(null)
    try {
      const response = await startDeployment.mutateAsync({ nodeId: selectedNode, component, operation, options: { preserveConfig, preserveData } })
      if (!response.success) throw new Error(errorMessage(response.error, '创建部署任务失败'))
      toast.success('部署任务已进入队列', { description: `${node?.name || selectedNode} · ${component}` })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '创建部署任务失败'
      setError(message)
      toast.error('部署任务创建失败', { description: message })
    } finally { setSubmitting(false) }
  }, [blockedNodes, component, node?.name, operation, preserveConfig, preserveData, startDeployment, selectedNode])

  // apiService 在 HTTP 失败时抛出 ApiError；不捕获的话异常逃逸，用户得不到任何反馈。
  const retry = useCallback(async (task: ComponentDeployStatus) => {
    try {
      const response = await retryDeployment.mutateAsync(task.taskId)
      if (!response.success) throw new Error(errorMessage(response.error, '无法重试该任务'))
      toast.success('已按原始输入创建重试任务')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '无法重试该任务'
      setError(message)
      toast.error('重试失败', { description: message })
    }
  }, [retryDeployment])

  const cancel = useCallback(async (task: ComponentDeployStatus) => {
    try {
      const response = await cancelDeployment.mutateAsync(task.taskId)
      if (!response.success) throw new Error(errorMessage(response.error, '任务已进入不可取消阶段'))
      toast.success('任务已取消')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '任务已进入不可取消阶段'
      setError(message)
      toast.error('取消失败', { description: message })
    }
  }, [cancelDeployment])

  // 「检查健康」必须真的探测目标节点：只刷新聚合状态无法证明刚装好的 Agent 已经起来了。
  const completeManual = useCallback(async () => {
    if (selectedNode) {
      const response = await healthCheck.mutateAsync(selectedNode)
      if (!response.success) toast.error('节点健康检查失败', { description: errorMessage(response.error, '目标节点尚未响应健康检查') })
      else toast.success('已完成目标节点健康检查', { description: node?.name || selectedNode })
    } else {
      await refresh()
    }
  }, [healthCheck, node?.name, refresh, selectedNode])

  const sshTarget = `${node?.sshUser || '<ssh-user>'}@${node?.host || '<child-host>'}`
  const installer = `curl -fsSL https://github.com/imal1/miobridge/releases/latest/download/install-agent.sh -o /tmp/install-agent.sh\nsh /tmp/install-agent.sh --config /tmp/miobridge-agent.yaml`

  return (
    <SignalPage crumb="Deployment control plane" title="部署中心" description="每次只处理一个节点和一个组件；安装态变更、运行态维护和监控状态彼此分离。" status={`${activeTasks.length} 个活动任务 · ${taskList.filter(item => item.status === 'error').length} 个失败任务`} maxWidth="narrow" actions={<Button variant="outline" onClick={refresh}><Icon icon="ph:arrow-clockwise-light" />刷新状态</Button>}>
      {error ? <Alert variant="destructive"><AlertTitle>部署操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.25fr]">
        <Card>
          <CardHeader><CardDescription>1 / 3 · 单目标任务</CardDescription><CardTitle>选择目标节点</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {nodes.map(item => (
              <button key={item.nodeId} type="button" onClick={() => setSelectedNode(item.nodeId)} className="flex w-full items-center justify-between gap-4 rounded-2xl border p-3 text-left" style={{ borderColor: selectedNode === item.nodeId ? 'var(--primary)' : 'var(--border)', background: selectedNode === item.nodeId ? 'var(--primary-container)' : 'var(--surface-container)' }}>
                <span><span className="block font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">{item.location} · {item.nodeId}</span></span>
                <span className="flex items-center gap-2"><Badge variant={installed(item, component) ? 'secondary' : 'outline'}>{installed(item, component) ? '已安装' : '未安装/未知'}</Badge><Icon icon={selectedNode === item.nodeId ? 'ph:check-circle-fill' : 'ph:circle-light'} /></span>
              </button>
            ))}
            {nodes.length === 0 ? <div className="rounded-2xl bg-[var(--surface-container)] p-6 text-center text-muted-foreground">请先在节点页添加节点</div> : null}
            <Button className="w-full" variant="outline" onClick={preflight} disabled={!selectedNode || preflighting}><Icon icon={preflighting ? 'ph:spinner-bold' : 'ph:shield-check-light'} className={preflighting ? 'animate-spin' : ''} />{preflighting ? '正在预检' : node?.nodeId === 'local' ? '执行本机预检' : '执行 SSH 预检'}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardDescription>2 / 3 · 单组件任务</CardDescription><CardTitle>选择部署内容</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {COMPONENTS.map(item => <button key={item.value} type="button" onClick={() => setComponent(item.value)} className="rounded-2xl border p-4 text-left" style={{ borderColor: component === item.value ? 'var(--primary)' : 'var(--border)', background: component === item.value ? 'var(--primary-container)' : 'var(--surface-container)' }}><Icon icon={item.icon} className="mb-3 h-6 w-6 text-primary" /><span className="block font-semibold">{item.label}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.description}</span></button>)}
            </div>
            {currentState ? <div className="grid gap-2 sm:grid-cols-3">{(Object.keys(STATE_LABELS) as Array<keyof typeof STATE_LABELS>).map(key => <div key={key} className="rounded-2xl bg-[var(--surface-container)] p-3"><p className="text-xs text-muted-foreground">{STATE_LABELS[key]}</p><p className="mt-1 font-medium">{currentState[key]}</p></div>)}</div> : null}
            <div className="grid gap-2"><label htmlFor="deploy-operation" className="text-sm font-medium">部署操作</label><Select id="deploy-operation" value={operation} onChange={event => setOperation(event.target.value as DeployOperation)}>{OPERATIONS.map(item => <option key={item.value} value={item.value}>{item.label} — {item.description}</option>)}</Select></div>
            {operation === 'uninstall' ? <div className="rounded-2xl border border-[var(--border)] p-4"><p className="font-medium">卸载保留策略</p><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={preserveConfig} onChange={event => setPreserveConfig(event.target.checked)} />保留配置（默认）</label><label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={preserveData} onChange={event => setPreserveData(event.target.checked)} />保留数据与日志（默认）</label></div> : null}
            <Alert><AlertTitle>任务边界</AlertTitle><AlertDescription>{node?.name || '未选择节点'} · {component} · {OPERATIONS.find(item => item.value === operation)?.label}。同节点同组件互斥；Agent 卸载还会阻止该节点其他部署任务。</AlertDescription></Alert>
            {blocking.length ? <Alert variant="destructive"><AlertTitle>SSH 预检存在阻断项</AlertTitle><AlertDescription>{blocking.join('、')}。修复后重新执行预检即可创建任务。</AlertDescription></Alert> : null}
            <div className="grid gap-2 sm:grid-cols-2"><Button onClick={submit} disabled={submitting || !selectedNode || blocking.length > 0}><Icon icon={submitting ? 'ph:spinner-bold' : operation === 'uninstall' ? 'ph:trash-light' : 'ph:rocket-launch-light'} className={submitting ? 'animate-spin' : ''} />{submitting ? '创建任务中' : '创建部署任务'}</Button>{component === 'agent' ? <Button variant="outline" onClick={() => setManualOpen(true)} disabled={!selectedNode}><Icon icon="ph:terminal-window-light" />手动 Shell 部署</Button> : null}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader><CardDescription>3 / 3 · SSE 实时更新，轮询自动降级</CardDescription><CardTitle>任务与恢复</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <QueryBoundary query={deploymentsQuery} skeleton={<div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-[20px]" />)}</div>}>
          {() => <>
          {taskList.map(task => {
            const taskNode = nodes.find(item => item.nodeId === task.nodeId)
            const cancellable = task.status === 'pending' || (task.status === 'running' && task.step === 'prechecking')
            return <article key={task.taskId} className="rounded-[20px] border border-[var(--border)] bg-[var(--surface-container)] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{taskNode?.name || task.nodeId} · {task.component}</p><p className="text-xs text-muted-foreground">{task.operation} · {STEP_LABELS[task.step] || task.step} · {new Date(task.startedAt).toLocaleString('zh-CN')}</p>{task.beforeVersion || task.afterVersion ? <p className="mt-1 text-xs text-muted-foreground">版本 {task.beforeVersion || '未知'} → {task.afterVersion || '待确认'}</p> : null}</div>{taskBadge(task)}</div><Progress className="mt-4" value={task.progress} /><div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm"><span className={task.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>{task.message}</span><div className="flex flex-wrap gap-2">{cancellable ? <Button size="sm" variant="outline" onClick={() => cancel(task)}>取消任务</Button> : null}{task.status === 'error' || task.status === 'cancelled' ? <Button size="sm" variant="outline" onClick={() => retry(task)}>按原输入重试</Button> : null}<Button asChild size="sm" variant="outline"><Link to={`/logs?node=${encodeURIComponent(task.nodeId)}&task=${encodeURIComponent(task.taskId)}`}>查看日志</Link></Button></div></div></article>
          })}
          {taskList.length === 0 ? <div className="rounded-[20px] bg-[var(--surface-container)] p-8 text-center text-muted-foreground">暂无部署任务。任务创建后会持久化，并在刷新或服务重启后恢复显示。</div> : null}
          </>}
          </QueryBoundary>

          {latestEvents.length ? (
            <section aria-label="部署任务事件" className="rounded-[20px] border border-[var(--border)] bg-[var(--surface-container-low)] p-4">
              <p className="mb-3 text-sm font-medium">最新任务事件时间线</p>
              <ol className="space-y-2">
                {latestEvents.map(event => (
                  <li key={event.eventId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                    <time dateTime={event.timestamp} className="font-mono text-xs text-muted-foreground">
                      {new Date(event.timestamp).toLocaleTimeString('zh-CN')}
                    </time>
                    <span className="text-xs text-muted-foreground">{STEP_LABELS[event.step] || event.step}</span>
                    <span>{event.message}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>手动 Shell 部署 Agent</DialogTitle><DialogDescription>适用于无法由控制面直连 SSH 的子节点。它只安装 Agent，不安装 CLI、Dashboard、Bun、mihomo 或协议核心。</DialogDescription></DialogHeader><div className="space-y-4 py-2"><div className="grid gap-2 sm:grid-cols-3"><div className="rounded-2xl bg-[var(--surface-container)] p-3"><p className="text-xs text-muted-foreground">节点 ID</p><p className="break-all font-medium">{selectedNode}</p></div><div className="rounded-2xl bg-[var(--surface-container)] p-3"><p className="text-xs text-muted-foreground">节点名称</p><p className="font-medium">{node?.name || '—'}</p></div><div className="rounded-2xl bg-[var(--surface-container)] p-3"><p className="text-xs text-muted-foreground">Agent 端口</p><p className="font-medium">{node?.agent?.port || 3001}</p></div></div><ol className="list-decimal space-y-2 pl-5 text-sm"><li>下载下方 Agent 配置，并传到子节点的 <code>/tmp/miobridge-agent.yaml</code>。</li><li>在子节点下载校验过的安装器并执行。</li><li>返回本页刷新状态，立即检查 Agent 健康和心跳。</li></ol><pre className="overflow-x-auto rounded-2xl bg-[var(--surface-container-high)] p-4 text-xs leading-6">scp agent.yaml {sshTarget}:/tmp/miobridge-agent.yaml{`\n\n`}{installer}</pre></div><DialogFooter><Button asChild variant="outline"><a href={apiService.manualAgentConfigUrl(selectedNode)}><Icon icon="ph:download-simple-light" />下载 Agent 配置</a></Button><Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(installer); toast.success('已复制安装命令') }}><Icon icon="ph:copy-light" />复制安装命令</Button><Button onClick={() => { setManualOpen(false); completeManual().catch(() => {}) }}>完成并检查健康</Button></DialogFooter></DialogContent>
      </Dialog>
    </SignalPage>
  )
}
