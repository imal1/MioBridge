import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Icon } from '@iconify/react'
import { toast } from 'sonner'
import { apiService, type ApiStatus } from '@/lib/api'
import {
  KERNEL_TYPES,
  isLocalNode,
  type ClusterStatus,
  type DeploymentCheck,
  type DeploymentPlan,
  type DeploymentScope,
  type DeployStatus,
  type KernelDetection,
  type KernelType,
  type NodeKernelConfig,
  type NodeStatus,
  type SshAuthMethod,
} from '@/lib/types'
import { AddNodeForm } from '@/components/cluster/AddNodeForm'
import { KernelDetectionDialog } from '@/components/cluster/KernelDetectionDialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import SignalPage from '@/components/shared/SignalPage'

type Filter = 'all' | 'action' | 'running' | 'failed' | 'ready'

interface KernelEditorState {
  node: NodeStatus
  detections: KernelDetection[]
  monitoredTypes: KernelType[]
  submitting: boolean
  error: string | null
}

interface ConnectionEditorState {
  node: NodeStatus
  host: string
  user: string
  port: string
  authMethod: SshAuthMethod
  password: string
  privateKey: string
  privateKeyName: string
  submitting: boolean
  error: string | null
}

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'action', label: '待处理' },
  { value: 'running', label: '部署中' },
  { value: 'failed', label: '失败' },
  { value: 'ready', label: '已就绪' },
]

const STEP_LABELS: Record<string, string> = {
  connect: '连接节点',
  upload: '上传文件',
  install: '安装程序',
  configure: '写入配置',
  kernel: '部署内核',
  agent: '部署监听程序',
  start: '启动服务',
  verify: '运行验收',
  done: '完成',
}

const SCOPE_LABELS: Record<DeploymentScope, string> = {
  listener: '监听程序',
  kernels: '已配置内核',
  all: '监听程序和内核',
}

const KERNEL_LABELS: Record<KernelType, string> = {
  'sing-box': 'Sing-Box',
  xray: 'Xray',
  v2ray: 'V2Ray',
}

const DEFAULT_CONFIG_PATHS: Record<KernelType, string> = {
  'sing-box': '/etc/sing-box/config.json',
  xray: '/usr/local/etc/xray/config.json',
  v2ray: '/etc/v2ray/config.json',
}

function running(deployment?: DeployStatus): boolean {
  return deployment?.status === 'running' || deployment?.status === 'pending'
}

function deploymentBadge(plan?: DeploymentPlan, deployment?: DeployStatus): {
  label: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
} {
  if (running(deployment)) return { label: '部署中', variant: 'default' }
  if (deployment?.status === 'error') return { label: '部署失败', variant: 'destructive' }
  if (plan?.ready) return { label: '已就绪', variant: 'secondary' }
  if (plan && !plan.deployable) return { label: '配置阻塞', variant: 'destructive' }
  if (plan?.recommendedScope) return { label: '待部署', variant: 'outline' }
  return { label: '状态检查中', variant: 'outline' }
}

function filterNode(filter: Filter, plan?: DeploymentPlan, deployment?: DeployStatus): boolean {
  if (filter === 'running') return running(deployment)
  if (filter === 'failed') return deployment?.status === 'error'
  if (filter === 'ready') return Boolean(plan?.ready) && !running(deployment)
  if (filter === 'action') return !plan?.ready && !running(deployment)
  return true
}

function checkIcon(check: DeploymentCheck): string {
  if (check.status === 'ready') return 'ph:check-circle-fill'
  if (check.status === 'blocked') return 'ph:x-circle-fill'
  return 'ph:warning-circle-fill'
}

function checkTone(check: DeploymentCheck): string {
  if (check.status === 'ready') return 'text-[var(--success)]'
  if (check.status === 'blocked') return 'text-destructive'
  return 'text-[var(--warning)]'
}

function CheckRow({ check }: { check: DeploymentCheck }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-[var(--surface-container)] p-3">
      <Icon icon={checkIcon(check)} className={`mt-0.5 h-4 w-4 shrink-0 ${checkTone(check)}`} />
      <div className="min-w-0">
        <p className="text-sm font-medium">{check.kernelType ? KERNEL_LABELS[check.kernelType] : check.label}</p>
        <p className="mt-0.5 break-words text-xs text-muted-foreground">{check.message}</p>
      </div>
    </div>
  )
}

function optimisticStatus(nodeId: string, deploymentId: string, scope: DeploymentScope): DeployStatus {
  return {
    nodeId,
    deploymentId,
    scope,
    step: 'connect',
    status: 'pending',
    message: '部署任务已进入队列',
    progress: 0,
    startedAt: Date.now(),
  }
}

export default function DeployPage() {
  const [cluster, setCluster] = useState<ClusterStatus | null>(null)
  const [hostStatus, setHostStatus] = useState<ApiStatus | null>(null)
  const [deployments, setDeployments] = useState<Record<string, DeployStatus>>({})
  const [plans, setPlans] = useState<Record<string, DeploymentPlan>>({})
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [streamConnected, setStreamConnected] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [addOpen, setAddOpen] = useState(false)
  const [kernelEditor, setKernelEditor] = useState<KernelEditorState | null>(null)
  const [connectionEditor, setConnectionEditor] = useState<ConnectionEditorState | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectionGenerationRef = useRef(0)

  const refresh = useCallback(async () => {
    const [clusterResult, deployResult, planResult, statusResult] = await Promise.all([
      apiService.getClusterStatus(),
      apiService.getDeployStatus(),
      apiService.getDeploymentPlans(),
      apiService.getStatus(),
    ])
    if (!clusterResult.success || !clusterResult.data) throw new Error(clusterResult.error || '节点状态加载失败')
    if (!deployResult.success) throw new Error(deployResult.error || '部署状态加载失败')
    if (!planResult.success || !planResult.data) throw new Error(planResult.error || '部署计划加载失败')
    setCluster(clusterResult.data as ClusterStatus)
    const deployData = deployResult.data as { deployments?: Record<string, DeployStatus> } | undefined
    setDeployments(deployData?.deployments || {})
    setPlans(planResult.data.plans || {})
    setHostStatus(statusResult)
  }, [])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => {
      refresh().catch(() => {})
    }, 250)
  }, [refresh])

  useEffect(() => {
    refresh().catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : '部署工作台加载失败')
    })
    const fallbackPoll = setInterval(() => refresh().catch(() => {}), 10_000)
    if (typeof EventSource === 'undefined') {
      return () => {
        clearInterval(fallbackPoll)
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      }
    }

    const events = new EventSource(apiService.getDeployEventsUrl())
    events.onopen = () => setStreamConnected(true)
    events.onerror = () => setStreamConnected(false)
    const onProgress = (event: MessageEvent<string>) => {
      try {
        const deployment = JSON.parse(event.data) as DeployStatus
        if (!deployment.nodeId) return
        setDeployments(current => ({ ...current, [deployment.nodeId]: deployment }))
        if (!running(deployment)) scheduleRefresh()
      } catch {
        // The regular refresh restores state after an invalid event.
      }
    }
    events.addEventListener('progress', onProgress as EventListener)
    return () => {
      clearInterval(fallbackPoll)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      events.removeEventListener('progress', onProgress as EventListener)
      events.close()
    }
  }, [refresh, scheduleRefresh])

  const allNodes = useMemo(() => cluster?.nodes || [], [cluster?.nodes])
  const visibleNodes = useMemo(() => allNodes.filter(node => filterNode(filter, plans[node.nodeId], deployments[node.nodeId])), [allNodes, deployments, filter, plans])
  const activeCount = allNodes.filter(node => running(deployments[node.nodeId])).length
  const readyCount = allNodes.filter(node => plans[node.nodeId]?.ready).length
  const preflightCount = allNodes.filter(node => plans[node.nodeId]?.preflightReady).length
  const failedCount = allNodes.filter(node => deployments[node.nodeId]?.status === 'error').length
  const actionableCount = allNodes.filter(node => plans[node.nodeId]?.recommendedScope && !running(deployments[node.nodeId])).length
  const allReady = allNodes.length > 0 && readyCount === allNodes.length
  const artifactFilesExist = Boolean(hostStatus?.subscriptionExists && hostStatus.clashExists && hostStatus.rawExists)
  const latestDeploymentAt = Math.max(0, ...allNodes.flatMap(node => [
    deployments[node.nodeId]?.startedAt ?? 0,
    node.agent?.lastDeploy ? Date.parse(node.agent.lastDeploy) || 0 : 0,
  ]))
  const artifactUpdatedAt = Math.min(
    hostStatus?.subscriptionLastUpdated ? Date.parse(hostStatus.subscriptionLastUpdated) || 0 : 0,
    hostStatus?.clashLastUpdated ? Date.parse(hostStatus.clashLastUpdated) || 0 : 0,
  )
  const deliveryReady = allReady && artifactFilesExist && artifactUpdatedAt >= latestDeploymentAt

  const deployNode = useCallback(async (nodeId: string, scope: DeploymentScope) => {
    setBusyAction(`${nodeId}:${scope}`)
    setError(null)
    try {
      const response = await apiService.deployNode(nodeId, scope)
      if (!response.success) throw new Error(response.error || '部署启动失败')
      const data = response.data as { deploymentId?: string } | undefined
      if (data?.deploymentId) {
        setDeployments(current => ({ ...current, [nodeId]: optimisticStatus(nodeId, data.deploymentId!, scope) }))
      }
      toast.success('部署已启动', { description: `${nodeId} · ${SCOPE_LABELS[scope]}` })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '部署失败，请查看日志'
      setError(message)
      toast.error('部署启动失败', { description: message })
    } finally {
      setBusyAction(null)
    }
  }, [])

  const deployPending = useCallback(async () => {
    setBatchBusy(true)
    setError(null)
    try {
      const response = await apiService.deployBatch()
      if (!response.success || !response.data) throw new Error(response.error || '批量部署启动失败')
      const started = response.data.results.filter(item => item.status === 'started' && item.deploymentId && item.scope)
      setDeployments(current => ({
        ...current,
        ...Object.fromEntries(started.map(item => [item.nodeId, optimisticStatus(item.nodeId, item.deploymentId!, item.scope!)])),
      }))
      if (response.data.failed > 0) {
        setError(`${response.data.failed} 个节点启动失败；其余可部署节点已继续执行`)
      }
      toast.success('批量部署已编排', {
        description: `启动 ${response.data.started} 个，跳过 ${response.data.skipped} 个，失败 ${response.data.failed} 个`,
      })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '批量部署失败'
      setError(message)
      toast.error('批量部署失败', { description: message })
    } finally {
      setBatchBusy(false)
    }
  }, [])

  const finalizeSubscription = useCallback(async () => {
    setFinalizing(true)
    setError(null)
    try {
      const result = await apiService.updateSubscription()
      if (!result.success) throw new Error(result.message || '订阅生成失败')
      await refresh()
      toast.success('部署闭环已完成', { description: `已生成 ${result.nodesCount} 个代理节点` })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '订阅验收失败'
      setError(message)
      toast.error('订阅验收失败', { description: message })
    } finally {
      setFinalizing(false)
    }
  }, [refresh])

  const openKernelEditor = useCallback(async (node: NodeStatus) => {
    const actionId = `${node.nodeId}:configure`
    setBusyAction(actionId)
    setError(null)
    try {
      const detections = isLocalNode(node)
        ? KERNEL_TYPES.map(type => {
            const runtime = node.kernels.find(kernel => kernel.type === type)
            return {
              type,
              installed: runtime?.detected ?? false,
              defaultConfigPath: runtime?.configPaths[0] || node.configuredKernels.find(kernel => kernel.type === type)?.configPath || DEFAULT_CONFIG_PATHS[type],
              ...(runtime?.version ? { version: runtime.version } : {}),
              ...(runtime?.error ? { error: runtime.error } : {}),
            }
          })
        : await apiService.detectKernels({ nodeId: node.nodeId })
      setKernelEditor({
        node,
        detections,
        monitoredTypes: node.configuredKernels.map(kernel => kernel.type),
        submitting: false,
        error: null,
      })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '内核检测失败'
      setError(message)
      toast.error('无法配置内核', { description: message })
    } finally {
      setBusyAction(null)
    }
  }, [])

  const confirmKernelEditor = useCallback(async (kernels: NodeKernelConfig[]) => {
    if (!kernelEditor) return
    const nodeId = kernelEditor.node.nodeId
    setKernelEditor(current => current ? { ...current, submitting: true, error: null } : current)
    try {
      const configured = await apiService.updateNodeKernels(nodeId, kernels)
      if (!configured.success) throw new Error(configured.error || '内核配置保存失败')
      const deployed = await apiService.deployNode(nodeId, 'all')
      if (!deployed.success) throw new Error(deployed.error || '内核配置已保存，但部署启动失败')
      const data = deployed.data as { deploymentId?: string } | undefined
      if (data?.deploymentId) {
        setDeployments(current => ({ ...current, [nodeId]: optimisticStatus(nodeId, data.deploymentId!, 'all') }))
      }
      setKernelEditor(null)
      scheduleRefresh()
      toast.success('配置已保存并开始部署')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '配置并部署失败'
      setKernelEditor(current => current ? { ...current, submitting: false, error: message } : current)
    }
  }, [kernelEditor, scheduleRefresh])

  const completeAddNode = useCallback(async () => {
    setAddOpen(false)
    await refresh()
    toast.success('节点已添加并开始部署')
  }, [refresh])

  const openConnectionEditor = useCallback((node: NodeStatus) => {
    const target = plans[node.nodeId]?.target
    connectionGenerationRef.current += 1
    setConnectionEditor({
      node,
      host: target?.host ?? '',
      user: target?.user ?? 'root',
      port: String(target?.port ?? 22),
      authMethod: 'password',
      password: '',
      privateKey: '',
      privateKeyName: '',
      submitting: false,
      error: null,
    })
  }, [plans])

  const closeConnectionEditor = useCallback(() => {
    connectionGenerationRef.current += 1
    setConnectionEditor(null)
  }, [])

  const uploadConnectionKey = useCallback((file?: File) => {
    if (!file) return
    const generation = connectionGenerationRef.current
    const reader = new FileReader()
    reader.onload = () => {
      if (generation !== connectionGenerationRef.current) return
      setConnectionEditor(current => current ? {
        ...current,
        privateKey: typeof reader.result === 'string' ? reader.result : '',
        privateKeyName: file.name,
      } : current)
    }
    reader.readAsText(file)
  }, [])

  const submitConnectionEditor = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    if (!connectionEditor || connectionEditor.submitting) return
    const generation = connectionGenerationRef.current
    const { node } = connectionEditor
    setConnectionEditor(current => current ? { ...current, submitting: true, error: null } : current)
    try {
      const updated = await apiService.updateNodeConnection(node.nodeId, {
        host: connectionEditor.host,
        user: connectionEditor.user,
        port: Number(connectionEditor.port),
        authMethod: connectionEditor.authMethod,
        ...(connectionEditor.authMethod === 'password'
          ? { password: connectionEditor.password }
          : { privateKey: connectionEditor.privateKey }),
      })
      if (!updated.success) throw new Error(updated.error || '连接信息保存失败')
      if (generation !== connectionGenerationRef.current) return
      closeConnectionEditor()
      if (node.configuredKernels.length === 0) {
        const detections = await apiService.detectKernels({ nodeId: node.nodeId })
        setKernelEditor({ node, detections, monitoredTypes: [], submitting: false, error: null })
        toast.success('连接已修复，请选择要部署的内核')
      } else {
        const deployed = await apiService.deployNode(node.nodeId, 'all')
        if (!deployed.success) throw new Error(deployed.error || '连接已保存，但部署启动失败')
        const data = deployed.data as { deploymentId?: string } | undefined
        if (data?.deploymentId) {
          setDeployments(current => ({ ...current, [node.nodeId]: optimisticStatus(node.nodeId, data.deploymentId!, 'all') }))
        }
        toast.success('连接已修复并开始一键部署')
      }
      scheduleRefresh()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '连接修复失败'
      if (generation === connectionGenerationRef.current) {
        setConnectionEditor(current => current ? { ...current, submitting: false, error: message } : current)
      } else {
        setError(message)
      }
    }
  }, [closeConnectionEditor, connectionEditor, scheduleRefresh])

  return (
    <SignalPage
      crumb="Deployment workflow"
      title="部署工作台"
      description="从节点配置、程序安装、实时执行到订阅验收，在一个页面完成部署闭环。"
      status={streamConnected ? '实时进度已连接' : '实时进度重连中'}
      maxWidth="narrow"
      actions={(
        <>
          <Button variant="outline" onClick={() => refresh().catch(caught => setError(caught instanceof Error ? caught.message : '刷新失败'))}>
            <Icon icon="ph:arrow-clockwise-light" />刷新
          </Button>
          <Button variant="outline" onClick={() => setAddOpen(true)}>
            <Icon icon="ph:plus-light" />添加节点
          </Button>
          <Button disabled={batchBusy || activeCount > 0 || actionableCount === 0} onClick={deployPending}>
            <Icon icon={batchBusy ? 'ph:spinner-bold' : 'ph:rocket-launch-bold'} className={batchBusy ? 'animate-spin' : ''} />
            {batchBusy ? '正在编排' : `部署全部待处理${actionableCount ? `（${actionableCount}）` : ''}`}
          </Button>
        </>
      )}
    >
      {error ? (
        <Alert variant="destructive" className="mb-5 flex gap-3">
          <Icon icon="ph:warning-circle-bold" className="mt-0.5 h-5 w-5 shrink-0" />
          <div><AlertTitle>部署流程需要处理</AlertTitle><AlertDescription>{error}</AlertDescription></div>
        </Alert>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-3" aria-label="部署业务流程">
        <Card variant="elevated">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between"><CardDescription>01 · 配置预检</CardDescription><Icon icon={preflightCount === allNodes.length && allNodes.length > 0 ? 'ph:check-circle-fill' : 'ph:sliders-horizontal-bold'} className="h-5 w-5 text-primary" /></div>
            <CardTitle className="signal-value">{preflightCount}/{allNodes.length}</CardTitle>
          </CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">节点连接凭据与内核选择均完整后才能进入一键部署。</p></CardContent>
        </Card>
        <Card variant="elevated">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between"><CardDescription>02 · 部署与运行验收</CardDescription><Icon icon={activeCount ? 'ph:spinner-bold' : 'ph:heartbeat-bold'} className={`h-5 w-5 text-primary ${activeCount ? 'animate-spin' : ''}`} /></div>
            <CardTitle className="signal-value signal-success">{readyCount}/{allNodes.length}</CardTitle>
          </CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">以监听成功和全部已配置内核可访问作为唯一成功标准。</p></CardContent>
        </Card>
        <Card variant="elevated">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between"><CardDescription>03 · 生成订阅并验收</CardDescription><Icon icon={deliveryReady ? 'ph:check-circle-fill' : 'ph:file-arrow-down-bold'} className="h-5 w-5 text-primary" /></div>
            <CardTitle className="text-2xl">{deliveryReady ? '产物可用' : allReady ? artifactFilesExist ? '需要重新生成' : '可以生成' : '等待部署'}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!allReady || activeCount > 0 || finalizing} onClick={finalizeSubscription}>
              <Icon icon={finalizing ? 'ph:spinner-bold' : 'ph:arrows-clockwise-bold'} className={finalizing ? 'animate-spin' : ''} />
              {finalizing ? '正在验收' : deliveryReady ? '重新生成并验收' : '生成并验收订阅'}
            </Button>
            {deliveryReady ? <Button asChild size="sm" variant="outline"><a href="/subscription">查看产物</a></Button> : null}
          </CardContent>
        </Card>
      </section>

      <Card className="mt-5">
        <CardHeader className="gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-xl">节点部署清单</CardTitle>
            <CardDescription>失败 {failedCount} 个 · 运行中 {activeCount} 个 · 已就绪 {readyCount} 个；按建议范围修复可避免无关组件重复部署。</CardDescription>
          </div>
          <Tabs value={filter} onValueChange={value => setFilter(value as Filter)}>
            <TabsList>{FILTERS.map(item => <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}</TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="grid gap-4">
          {visibleNodes.map(node => {
            const plan = plans[node.nodeId]
            const deployment = deployments[node.nodeId]
            const badge = deploymentBadge(plan, deployment)
            const progress = deployment?.progress ?? (plan?.ready ? 100 : 0)
            const active = running(deployment)
            const primaryScope = plan?.recommendedScope ?? 'all'
            const actionBusy = busyAction === `${node.nodeId}:${primaryScope}`
            const prerequisites = plan?.checks.filter(check => check.category === 'prerequisite') || []
            const listenerChecks = plan?.checks.filter(check => check.category === 'listener') || []
            const kernelChecks = plan?.checks.filter(check => check.category === 'kernel') || []
            return (
              <article key={node.nodeId} className="rounded-[24px] border border-[var(--border)] bg-[var(--surface-container-lowest)] p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold">{node.name}</h2>
                      <Badge variant={isLocalNode(node) ? 'default' : 'outline'}>{isLocalNode(node) ? '本机节点' : '节点'}</Badge>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <p className="mt-1 break-words text-sm text-muted-foreground">{node.location} · {node.nodeId}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 xl:justify-end">
                    {plan && !plan.deployable ? (
                      plan.blockers.some(blocker => blocker.includes('内核'))
                        ? <Button size="sm" disabled={busyAction !== null || active} onClick={() => openKernelEditor(node)}><Icon icon="ph:sliders-horizontal-bold" />配置内核并部署</Button>
                        : <Button size="sm" disabled={busyAction !== null || active} onClick={() => openConnectionEditor(node)}><Icon icon="ph:key-bold" />修复连接并部署</Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={busyAction !== null || batchBusy || active}
                        variant={plan?.ready ? 'outline' : 'default'}
                        onClick={() => deployNode(node.nodeId, primaryScope)}
                      >
                        <Icon icon={actionBusy || active ? 'ph:spinner-bold' : 'ph:rocket-launch-bold'} className={actionBusy || active ? 'animate-spin' : ''} />
                        {active ? '部署中' : plan?.ready ? '重新部署全部' : '一键部署'}
                      </Button>
                    )}
                    {plan?.deployable ? <Button size="sm" variant="outline" disabled={busyAction !== null || active} onClick={() => openKernelEditor(node)}>调整内核</Button> : null}
                    <Button asChild size="sm" variant="outline"><a href={`/logs?node=${encodeURIComponent(node.nodeId)}`}>查看日志</a></Button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-3">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">部署前置</p>
                    <div className="grid gap-2">{prerequisites.map(check => <CheckRow key={check.id} check={check} />)}</div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">监听程序</p>
                    <div className="grid gap-2">{listenerChecks.map(check => <CheckRow key={check.id} check={check} />)}</div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">已配置内核</p>
                    <div className="grid gap-2">{kernelChecks.map(check => <CheckRow key={check.id} check={check} />)}</div>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-container)] p-4">
                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="font-medium">{deployment ? STEP_LABELS[deployment.step] || deployment.step : '运行状态'}</span>
                    <span className="signal-mono text-xs text-muted-foreground">{progress}%</span>
                  </div>
                  <Progress value={progress} className="mt-2" />
                  <p className="mt-2 break-words text-sm text-muted-foreground">{deployment?.message || plan?.blockers[0] || (plan?.ready ? '监听程序和全部已配置内核均已通过验收' : '等待部署计划')}</p>
                  {!isLocalNode(node) && plan?.deployable && !active ? (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
                      <span className="mr-1 self-center text-xs text-muted-foreground">按组件重新部署</span>
                      <Button size="sm" variant="outline" disabled={busyAction !== null} onClick={() => deployNode(node.nodeId, 'listener')}>仅监听程序</Button>
                      <Button size="sm" variant="outline" disabled={busyAction !== null} onClick={() => deployNode(node.nodeId, 'kernels')}>仅内核</Button>
                      <Button size="sm" variant="outline" disabled={busyAction !== null} onClick={() => deployNode(node.nodeId, 'all')}>全部</Button>
                    </div>
                  ) : null}
                </div>
              </article>
            )
          })}
          {visibleNodes.length === 0 ? (
            <div className="rounded-[24px] border border-[var(--border)] bg-[var(--surface-container)] p-10 text-center text-muted-foreground">
              {allNodes.length === 0 ? '尚未配置节点，可从右上角添加节点开始' : '当前筛选条件下没有节点'}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {kernelEditor ? (
        <KernelDetectionDialog
          key={`${kernelEditor.node.nodeId}:${kernelEditor.detections.map(item => `${item.type}:${item.installed}`).join('|')}:${kernelEditor.monitoredTypes.join('|')}`}
          open
          detections={kernelEditor.detections}
          monitoredTypes={kernelEditor.monitoredTypes}
          submitting={kernelEditor.submitting}
          error={kernelEditor.error}
          confirmLabel={kernelEditor.error ? '重试配置并部署' : '保存配置并一键部署'}
          onCancel={() => { if (!kernelEditor.submitting) setKernelEditor(null) }}
          onConfirm={confirmKernelEditor}
        />
      ) : null}

      <Dialog open={Boolean(connectionEditor)} onOpenChange={open => { if (!open && !connectionEditor?.submitting) closeConnectionEditor() }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          {connectionEditor ? (
            <form onSubmit={submitConnectionEditor}>
              <DialogHeader>
                <DialogTitle>修复 {connectionEditor.node.name} 的连接</DialogTitle>
                <DialogDescription>重新保存 SSH 连接与凭据；保存成功后会自动继续内核配置或一键部署。</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                {connectionEditor.error ? <Alert variant="destructive"><AlertDescription>{connectionEditor.error}</AlertDescription></Alert> : null}
                <div className="grid gap-2">
                  <Label htmlFor="repair-host">主机地址</Label>
                  <Input id="repair-host" value={connectionEditor.host} autoComplete="off" required onChange={event => setConnectionEditor(current => current ? { ...current, host: event.target.value } : current)} />
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
                  <div className="grid gap-2">
                    <Label htmlFor="repair-user">SSH 用户</Label>
                    <Input id="repair-user" value={connectionEditor.user} autoComplete="username" required onChange={event => setConnectionEditor(current => current ? { ...current, user: event.target.value } : current)} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="repair-port">端口</Label>
                    <Input id="repair-port" type="number" min="1" max="65535" value={connectionEditor.port} required onChange={event => setConnectionEditor(current => current ? { ...current, port: event.target.value } : current)} />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>认证方式</Label>
                  <div className="flex gap-2">
                    {(['password', 'privateKey'] as const).map(method => (
                      <Button key={method} type="button" size="sm" variant={connectionEditor.authMethod === method ? 'default' : 'outline'} onClick={() => setConnectionEditor(current => current ? { ...current, authMethod: method, password: '', privateKey: '', privateKeyName: '' } : current)}>
                        {method === 'password' ? '密码' : '私钥'}
                      </Button>
                    ))}
                  </div>
                </div>
                {connectionEditor.authMethod === 'password' ? (
                  <div className="grid gap-2">
                    <Label htmlFor="repair-password">SSH 密码</Label>
                    <Input id="repair-password" type="password" autoComplete="new-password" value={connectionEditor.password} required onChange={event => setConnectionEditor(current => current ? { ...current, password: event.target.value } : current)} />
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <Label htmlFor="repair-private-key">SSH 私钥文件</Label>
                    <Input id="repair-private-key" type="file" autoComplete="off" required onChange={event => uploadConnectionKey(event.target.files?.[0])} />
                    {connectionEditor.privateKeyName ? <p className="text-sm text-muted-foreground">{connectionEditor.privateKeyName}</p> : null}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" disabled={connectionEditor.submitting} onClick={closeConnectionEditor}>取消</Button>
                <Button type="submit" disabled={connectionEditor.submitting}>
                  <Icon icon={connectionEditor.submitting ? 'ph:spinner-bold' : 'ph:key-bold'} className={connectionEditor.submitting ? 'animate-spin' : ''} />
                  {connectionEditor.submitting ? '正在保存' : '保存并继续部署'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <AddNodeForm isOpen={addOpen} onClose={() => setAddOpen(false)} onComplete={completeAddNode} />
    </SignalPage>
  )
}
