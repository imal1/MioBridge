import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { toast } from 'sonner'
import { apiService } from '@/lib/api'
import type { ClusterStatus, KernelType, NodeKernelConfig, NodeStatus } from '@/lib/types'
import type { KernelDetection } from '@/lib/types'
import { AddNodeForm } from '@/components/cluster/AddNodeForm'
import { KernelDetectionDialog } from '@/components/cluster/KernelDetectionDialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import SignalPage from '@/components/shared/SignalPage'
import { KernelRuntimeDetails, KernelStatusPills, kernelLabels } from '@/components/cluster/KernelStatus'

type Filter = 'all' | 'online' | 'offline' | 'undeployed'

interface KernelEditorState {
  node: NodeStatus
  detections: KernelDetection[]
  monitoredTypes: KernelType[]
  submitting: boolean
  error: string | null
}

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'online', label: '在线' },
  { value: 'offline', label: '异常' },
  { value: 'undeployed', label: '未部署' },
]

function agentLabel(node: NodeStatus) {
  switch (node.agent?.status) {
    case 'running': return '运行中'
    case 'deploying': return '部署中'
    case 'stopped': return '已停止'
    case 'error': return '异常'
    default: return '未部署'
  }
}

function kernelSummary(node: NodeStatus) {
  const desired = node.configuredKernels.length > 0
    ? node.configuredKernels.map(kernel => kernelLabels[kernel.type]).join(' · ')
    : '未配置内核'
  return node.online ? desired : `${desired} · 状态未知`
}

interface NodesPageProps {
  initialCluster?: ClusterStatus | null
  initialError?: string | null
}

export default function NodesPage({ initialCluster, initialError = null }: NodesPageProps = {}) {
  const [cluster, setCluster] = useState<ClusterStatus | null>(initialCluster ?? null)
  const [error, setError] = useState<string | null>(initialError)
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedNode, setSelectedNode] = useState<NodeStatus | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [busyNode, setBusyNode] = useState<string | null>(null)
  const [kernelEditor, setKernelEditor] = useState<KernelEditorState | null>(null)
  const editLockRef = useRef(false)

  const refresh = useCallback(async () => {
    const result = await apiService.getClusterStatus()
    if (result.success) setCluster(result.data as ClusterStatus)
  }, [])

  useEffect(() => {
    if (initialCluster !== undefined) return
    let active = true
    apiService.getClusterStatus()
      .then(result => {
        if (active && result.success) setCluster(result.data as ClusterStatus)
      })
      .catch((err: unknown) => {
        if (!active) return
        const message = err instanceof Error ? err.message : '加载失败'
        setError(message)
      })
    return () => { active = false }
  }, [initialCluster])

  const nodes = useMemo(() => {
    const list = cluster?.nodes || []
    if (filter === 'online') return list.filter(node => node.online)
    if (filter === 'offline') return list.filter(node => !node.online)
    if (filter === 'undeployed') return list.filter(node => node.nodeId !== 'local' && !node.agent?.deployed)
    return list
  }, [cluster?.nodes, filter])

  const runNodeAction = useCallback(async (nodeId: string, action: () => Promise<unknown>) => {
    setBusyNode(nodeId)
    setError(null)
    try {
      await action()
      await refresh()
      toast.success('节点操作已触发')
    } catch (err) {
      const message = err instanceof Error ? err.message : '操作失败，请查看日志'
      setError(message)
      toast.error('节点操作失败', { description: message })
    } finally {
      setBusyNode(null)
    }
  }, [refresh])

  const completeAddNode = useCallback(async () => {
    setAddOpen(false)
    await refresh()
    toast.success('节点已添加，部署已启动')
  }, [refresh])

  const openKernelEditor = useCallback(async (node: NodeStatus) => {
    if (editLockRef.current) return
    editLockRef.current = true
    setBusyNode(node.nodeId)
    setError(null)
    try {
      const detections = await apiService.detectKernels({ nodeId: node.nodeId })
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
      toast.error('内核检测失败', { description: message })
    } finally {
      editLockRef.current = false
      setBusyNode(null)
    }
  }, [])

  const confirmKernelEditor = useCallback(async (kernels: NodeKernelConfig[]) => {
    if (!kernelEditor || editLockRef.current) return
    editLockRef.current = true
    const { node } = kernelEditor
    setKernelEditor(previous => previous ? { ...previous, submitting: true, error: null } : previous)
    try {
      const deployment = await apiService.deployNode(node.nodeId, kernels)
      if (!deployment.success) throw new Error(deployment.error || '部署启动失败，可重试')
      setKernelEditor(null)
      await refresh()
      toast.success('内核部署已启动')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '部署启动失败，可重试'
      setKernelEditor(previous => previous ? { ...previous, error: message } : previous)
    } finally {
      editLockRef.current = false
      setKernelEditor(previous => previous ? { ...previous, submitting: false } : previous)
    }
  }, [kernelEditor, refresh])

  return (
    <TooltipProvider>
    <SignalPage
      crumb="Fleet topology"
      title="节点"
      description="管理子节点和远端 Agent，按生命周期状态执行健康检查、部署和恢复。"
      status={`子节点心跳 ${cluster?.lastUpdated ? new Date(cluster.lastUpdated).toLocaleTimeString('zh-CN') : '待同步'}`}
      maxWidth="narrow"
      actions={(
        <>
          <Button variant="outline" onClick={refresh}>
            <Icon icon="ph:arrow-clockwise-light" />
            刷新
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Icon icon="ph:plus-light" />
            添加节点
          </Button>
        </>
      )}
    >

      {error ? (
        <Alert variant="destructive" className="flex gap-3">
          <Icon icon="ph:warning-circle-bold" className="mt-0.5 h-5 w-5" />
          <div>
            <AlertTitle>节点操作失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
        </Alert>
      ) : null}

      <div className="grid gap-5 md:grid-cols-3">
        <Card variant="elevated">
          <CardHeader className="pb-3"><CardDescription>子节点总数</CardDescription><CardTitle className="signal-value">{cluster?.totalNodes ?? 0}</CardTitle></CardHeader>
        </Card>
        <Card variant="elevated">
          <CardHeader className="pb-3"><CardDescription>在线子节点</CardDescription><CardTitle className="signal-value signal-success">{cluster?.onlineNodes ?? 0}</CardTitle></CardHeader>
        </Card>
        <Card variant="elevated">
          <CardHeader className="pb-3"><CardDescription>代理总数</CardDescription><CardTitle className="signal-value">{cluster?.totalProxies ?? 0}</CardTitle></CardHeader>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-xl">节点生命周期</CardTitle>
            <CardDescription className="flex items-center gap-1">
              子节点提供节点源，控制面聚合后生成 raw.txt、subscription.txt 和 clash.yaml。
              <Tooltip>
                <TooltipTrigger asChild>
                  <Icon icon="ph:info-bold" className="h-3.5 w-3.5 cursor-help" />
                </TooltipTrigger>
                <TooltipContent>本机控制面只聚合与转换，不作为子节点参与统计</TooltipContent>
              </Tooltip>
            </CardDescription>
          </div>
          <Tabs value={filter} onValueChange={value => setFilter(value as Filter)}>
            <TabsList>
              {FILTERS.map(item => <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
            {nodes.map(node => (
              <article key={node.nodeId} className="rounded-[24px] border border-[var(--border)] bg-[var(--surface-container)] p-5">
                <button className="w-full text-left" onClick={() => setSelectedNode(node)}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[var(--border)] bg-[var(--surface-container-lowest)] signal-mono">
                        {node.location?.slice(0, 2).toUpperCase() || node.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h2 className="truncate text-2xl font-semibold leading-tight">{node.name}</h2>
                        <p className="text-sm text-muted-foreground">{kernelSummary(node)} · {node.nodeId}</p>
                      </div>
                    </div>
                    <Badge variant={node.online ? 'secondary' : 'destructive'}>{node.online ? '在线' : '异常'}</Badge>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <KernelStatusPills
                      online={node.online}
                      kernels={node.kernels}
                      configuredKernels={node.configuredKernels}
                    />
                  </div>
                  <div className="mt-6 flex items-end justify-between gap-4">
                    <div>
                      <p className="signal-mono text-3xl text-primary">{node.latency ? `${node.latency}ms` : node.online ? 'live' : 'down'}</p>
                      <p className="mt-2 text-sm text-muted-foreground">{node.nodesCount ?? '-'} 个代理 · {agentLabel(node)}</p>
                    </div>
                    <div className="flex items-end gap-1">
                      {Array.from({ length: node.online ? 4 : 2 }).map((_, index) => (
                        <span key={index} className="block w-1.5 rounded-full bg-primary" style={{ height: 8 + index * 6 }} />
                      ))}
                    </div>
                  </div>
                </button>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={busyNode === node.nodeId} onClick={() => runNodeAction(node.nodeId, () => apiService.clusterHealthCheck(node.nodeId))}>检查</Button>
                  {node.nodeId !== 'local' ? (
                    <Button size="sm" variant="outline" disabled={busyNode === node.nodeId} onClick={() => openKernelEditor(node)}>调整内核</Button>
                  ) : null}
                  {node.nodeId !== 'local' && !node.agent?.deployed ? (
                    <Button size="sm" disabled={busyNode === node.nodeId} onClick={() => runNodeAction(node.nodeId, () => apiService.deployNode(node.nodeId))}>部署</Button>
                  ) : null}
                  {node.nodeId !== 'local' && node.agent?.status === 'running' ? (
                    <Button size="sm" variant="outline" disabled={busyNode === node.nodeId} onClick={() => runNodeAction(node.nodeId, () => apiService.restartAgent(node.nodeId))}>重启</Button>
                  ) : null}
                </div>
              </article>
            ))}
            {nodes.length === 0 ? (
              <div className="rounded-[24px] border border-[var(--border)] bg-[var(--surface-container)] p-10 text-center text-muted-foreground">还没有匹配的子节点</div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selectedNode} onOpenChange={open => { if (!open) setSelectedNode(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedNode?.name}</DialogTitle>
            <DialogDescription>{selectedNode?.location} · {selectedNode?.nodeId}</DialogDescription>
          </DialogHeader>
          <Separator />
          {selectedNode ? (
            <div className="grid gap-3 text-sm">
              {[
                ['在线状态', selectedNode.online ? '在线' : selectedNode.error || '异常'],
                ['内核', kernelSummary(selectedNode)],
                ['代理数量', selectedNode.nodesCount ?? '-'],
                ['版本', selectedNode.version || '-'],
                ['Agent', `${agentLabel(selectedNode)} ${selectedNode.agent?.version || ''}`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 rounded-2xl bg-[var(--surface-container)] p-3">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="min-w-0 break-words text-right font-medium">{value}</span>
                </div>
              ))}
              <KernelRuntimeDetails
                online={selectedNode.online}
                kernels={selectedNode.kernels}
                configuredKernels={selectedNode.configuredKernels}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {kernelEditor ? (
        <KernelDetectionDialog
          key={`${kernelEditor.node.nodeId}:${kernelEditor.detections.map(item => `${item.type}:${item.installed}:${item.defaultConfigPath}`).join('|')}:${kernelEditor.monitoredTypes.join('|')}`}
          open
          detections={kernelEditor.detections}
          monitoredTypes={kernelEditor.monitoredTypes}
          submitting={kernelEditor.submitting}
          error={kernelEditor.error}
          confirmLabel={kernelEditor.error ? '重试部署' : '确认并部署'}
          onCancel={() => { if (!kernelEditor.submitting) setKernelEditor(null) }}
          onConfirm={confirmKernelEditor}
        />
      ) : null}

      <AddNodeForm isOpen={addOpen} onClose={() => setAddOpen(false)} onComplete={completeAddNode} />
    </SignalPage>
    </TooltipProvider>
  )
}
