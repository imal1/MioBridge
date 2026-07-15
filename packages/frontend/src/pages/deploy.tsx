import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { apiService } from '@/lib/api'
import type { ClusterStatus, ComponentDeployStatus, ComponentState, DeployComponent, DeployOperation, NodeStatus } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Select } from '@/components/ui/select'
import SignalPage from '@/components/shared/SignalPage'
import WorkflowRail from '@/components/shared/WorkflowRail'

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

function installed(node: NodeStatus, component: DeployComponent) {
  if (component === 'agent') return Boolean(node.agent?.deployed)
  if (component === 'mihomo') return Boolean(node.mihomoAvailable)
  return Boolean(node.kernels.find(kernel => kernel.type === component)?.detected)
}

export default function DeployPage() {
  const [searchParams] = useSearchParams()
  const requestedComponent = searchParams.get('component') as DeployComponent | null
  const requestedOperation = searchParams.get('operation') as DeployOperation | null
  const [cluster, setCluster] = useState<ClusterStatus | null>(null)
  const [tasks, setTasks] = useState<Record<string, ComponentDeployStatus>>({})
  const [states, setStates] = useState<ComponentState[]>([])
  const [selectedNode, setSelectedNode] = useState(searchParams.get('node') || '')
  const [component, setComponent] = useState<DeployComponent>(COMPONENTS.some(item => item.value === requestedComponent) ? requestedComponent! : 'agent')
  const [operation, setOperation] = useState<DeployOperation>(OPERATIONS.some(item => item.value === requestedOperation) ? requestedOperation! : 'install')
  const [preserveConfig, setPreserveConfig] = useState(true)
  const [preserveData, setPreserveData] = useState(true)
  const [manualOpen, setManualOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [preflighting, setPreflighting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [clusterResult, taskResult, stateResult] = await Promise.all([
      apiService.getClusterStatus(), apiService.getComponentDeployments(), apiService.getComponentStates(),
    ])
    if (clusterResult.success) setCluster(clusterResult.data as ClusterStatus)
    if (taskResult.success && taskResult.data) setTasks(taskResult.data.deployments)
    if (stateResult.success && stateResult.data) setStates(stateResult.data.states)
  }, [])

  useEffect(() => {
    refresh().catch(caught => setError(caught instanceof Error ? caught.message : '部署状态加载失败'))
    const timer = window.setInterval(() => refresh().catch(() => {}), 4000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const nodes = useMemo(() => (cluster?.nodes || []).filter(node => node.nodeId !== 'local'), [cluster?.nodes])
  const taskList = useMemo(() => Object.values(tasks).sort((a, b) => b.startedAt - a.startedAt), [tasks])
  const activeTasks = useMemo(() => taskList.filter(task => task.status === 'running' || task.status === 'pending'), [taskList])
  const currentState = states.find(item => item.nodeId === selectedNode && item.component === component)
  const node = nodes.find(item => item.nodeId === selectedNode)

  useEffect(() => {
    if (!selectedNode && nodes[0]) setSelectedNode(nodes[0].nodeId)
  }, [nodes, selectedNode])

  useEffect(() => {
    const streams = activeTasks.map(task => {
      const stream = new EventSource(`/api/deployments/${encodeURIComponent(task.taskId)}/events`)
      const onEvent = () => refresh().catch(() => {})
      stream.addEventListener('progress', onEvent)
      stream.addEventListener('complete', onEvent)
      stream.onerror = () => stream.close()
      return stream
    })
    return () => streams.forEach(stream => stream.close())
  }, [activeTasks.map(task => task.taskId).join(','), refresh])

  const preflight = useCallback(async () => {
    if (!selectedNode) return
    setPreflighting(true)
    setError(null)
    try {
      const response = await apiService.preflightDeployment(selectedNode)
      if (!response.success) throw new Error(errorMessage(response.error, 'SSH 预检失败'))
      const failed = response.data?.checks.filter(check => !check.ok) ?? []
      if (failed.length) toast.warning('预检完成，存在阻断项', { description: failed.map(item => item.label).join('、') })
      else toast.success('SSH 预检通过', { description: `${response.data?.architecture || '未知架构'} · systemd 可用` })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'SSH 预检失败'
      setError(message)
    } finally { setPreflighting(false) }
  }, [selectedNode])

  const submit = useCallback(async () => {
    if (!selectedNode) return setError('请选择一个目标节点')
    setSubmitting(true)
    setError(null)
    try {
      const response = await apiService.startComponentDeployment(selectedNode, component, operation, { preserveConfig, preserveData })
      if (!response.success) throw new Error(errorMessage(response.error, '创建部署任务失败'))
      toast.success('部署任务已进入队列', { description: `${node?.name || selectedNode} · ${component}` })
      await refresh()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '创建部署任务失败'
      setError(message)
      toast.error('部署任务创建失败', { description: message })
    } finally { setSubmitting(false) }
  }, [component, node?.name, operation, preserveConfig, preserveData, refresh, selectedNode])

  const retry = useCallback(async (task: ComponentDeployStatus) => {
    const response = await apiService.retryComponentDeployment(task.taskId)
    if (!response.success) return toast.error('重试失败', { description: errorMessage(response.error, '无法重试该任务') })
    toast.success('已按原始输入创建重试任务')
    await refresh()
  }, [refresh])

  const cancel = useCallback(async (task: ComponentDeployStatus) => {
    const response = await apiService.cancelComponentDeployment(task.taskId)
    if (!response.success) return toast.error('取消失败', { description: errorMessage(response.error, '任务已进入不可取消阶段') })
    toast.success('任务已取消')
    await refresh()
  }, [refresh])

  const installer = `curl -fsSL https://github.com/imal1/miobridge/releases/latest/download/install-agent.sh -o /tmp/install-agent.sh\nsudo sh /tmp/install-agent.sh --config /tmp/miobridge-agent.yaml`

  return (
    <SignalPage crumb="Deployment control plane" title="部署中心" description="每次只处理一个节点和一个组件；安装态变更、运行态维护和监控状态彼此分离。" status={`${activeTasks.length} 个活动任务 · ${taskList.filter(item => item.status === 'error').length} 个失败任务`} maxWidth="narrow" actions={<Button variant="outline" onClick={refresh}><Icon icon="ph:arrow-clockwise-light" />刷新状态</Button>}>
      <WorkflowRail current={component === 'agent' ? 'deploy-agent' : 'deploy-kernel'} />
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
            {nodes.length === 0 ? <div className="rounded-2xl bg-[var(--surface-container)] p-6 text-center text-muted-foreground">请先在节点页添加远端节点</div> : null}
            <Button className="w-full" variant="outline" onClick={preflight} disabled={!selectedNode || preflighting}><Icon icon={preflighting ? 'ph:spinner-bold' : 'ph:shield-check-light'} className={preflighting ? 'animate-spin' : ''} />{preflighting ? '正在预检' : '执行 SSH 预检'}</Button>
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
            <div className="grid gap-2 sm:grid-cols-2"><Button onClick={submit} disabled={submitting || !selectedNode}><Icon icon={submitting ? 'ph:spinner-bold' : operation === 'uninstall' ? 'ph:trash-light' : 'ph:rocket-launch-light'} className={submitting ? 'animate-spin' : ''} />{submitting ? '创建任务中' : '创建部署任务'}</Button>{component === 'agent' ? <Button variant="outline" onClick={() => setManualOpen(true)} disabled={!selectedNode}><Icon icon="ph:terminal-window-light" />手动 Shell 部署</Button> : null}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader><CardDescription>3 / 3 · SSE 实时更新，轮询自动降级</CardDescription><CardTitle>任务与恢复</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {taskList.map(task => {
            const taskNode = nodes.find(item => item.nodeId === task.nodeId)
            const cancellable = task.status === 'pending' || (task.status === 'running' && task.step === 'prechecking')
            return <article key={task.taskId} className="rounded-[20px] border border-[var(--border)] bg-[var(--surface-container)] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{taskNode?.name || task.nodeId} · {task.component}</p><p className="text-xs text-muted-foreground">{task.operation} · {STEP_LABELS[task.step] || task.step} · {new Date(task.startedAt).toLocaleString('zh-CN')}</p>{task.beforeVersion || task.afterVersion ? <p className="mt-1 text-xs text-muted-foreground">版本 {task.beforeVersion || '未知'} → {task.afterVersion || '待确认'}</p> : null}</div>{taskBadge(task)}</div><Progress className="mt-4" value={task.progress} /><div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm"><span className={task.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>{task.message}</span><div className="flex flex-wrap gap-2">{cancellable ? <Button size="sm" variant="outline" onClick={() => cancel(task)}>取消任务</Button> : null}{task.status === 'error' || task.status === 'cancelled' ? <Button size="sm" variant="outline" onClick={() => retry(task)}>按原输入重试</Button> : null}<Button asChild size="sm" variant="outline"><Link to={`/logs?node=${encodeURIComponent(task.nodeId)}&task=${encodeURIComponent(task.taskId)}`}>查看日志</Link></Button></div></div></article>
          })}
          {taskList.length === 0 ? <div className="rounded-[20px] bg-[var(--surface-container)] p-8 text-center text-muted-foreground">暂无部署任务。任务创建后会持久化，并在刷新或服务重启后恢复显示。</div> : null}
        </CardContent>
      </Card>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>手动 Shell 部署 Agent</DialogTitle><DialogDescription>适用于无法由控制面直连 SSH 的子节点。它只安装 Agent，不安装 CLI、Dashboard、Bun、mihomo 或协议核心。</DialogDescription></DialogHeader><div className="space-y-4 py-2"><div className="grid gap-2 sm:grid-cols-3"><div className="rounded-2xl bg-[var(--surface-container)] p-3"><p className="text-xs text-muted-foreground">节点 ID</p><p className="break-all font-medium">{selectedNode}</p></div><div className="rounded-2xl bg-[var(--surface-container)] p-3"><p className="text-xs text-muted-foreground">节点名称</p><p className="font-medium">{node?.name || '—'}</p></div><div className="rounded-2xl bg-[var(--surface-container)] p-3"><p className="text-xs text-muted-foreground">Agent 端口</p><p className="font-medium">{node?.agent?.port || 3001}</p></div></div><ol className="list-decimal space-y-2 pl-5 text-sm"><li>下载下方 Agent 配置，并传到子节点的 <code>/tmp/miobridge-agent.yaml</code>。</li><li>在子节点下载校验过的安装器并执行。</li><li>返回本页刷新状态，立即检查 Agent 健康和心跳。</li></ol><pre className="overflow-x-auto rounded-2xl bg-[var(--surface-container-high)] p-4 text-xs leading-6">scp agent.yaml root@child:/tmp/miobridge-agent.yaml{`\n\n`}{installer}</pre></div><DialogFooter><Button asChild variant="outline"><a href={apiService.manualAgentConfigUrl(selectedNode)}><Icon icon="ph:download-simple-light" />下载 Agent 配置</a></Button><Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(installer); toast.success('已复制安装命令') }}><Icon icon="ph:copy-light" />复制安装命令</Button><Button onClick={() => { setManualOpen(false); refresh().catch(() => {}) }}>完成并检查健康</Button></DialogFooter></DialogContent>
      </Dialog>
    </SignalPage>
  )
}
