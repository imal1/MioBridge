import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { apiService } from '@/lib/api'
import { KERNEL_TYPES, type ClusterStatus, type ComponentState, type KernelDetection, type KernelType, type NodeKernelConfig } from '@/lib/types'
import { KernelDetectionDialog } from '@/components/cluster/KernelDetectionDialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import SignalPage from '@/components/shared/SignalPage'

const LABELS: Record<KernelType, string> = { 'sing-box': 'sing-box', xray: 'Xray', v2ray: 'V2Ray' }

export default function RuntimesPage() {
  const [params, setParams] = useSearchParams()
  const [cluster, setCluster] = useState<ClusterStatus | null>(null)
  const [componentStates, setComponentStates] = useState<ComponentState[]>([])
  const [detections, setDetections] = useState<KernelDetection[]>([])
  const [editorOpen, setEditorOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const nodes = useMemo(() => cluster?.nodes || [], [cluster?.nodes])
  const nodeId = params.get('node') || nodes[0]?.nodeId || ''
  const node = nodes.find(item => item.nodeId === nodeId)

  const refreshCluster = useCallback(async () => {
    const result = await apiService.getClusterStatus()
    if (result.success) setCluster(result.data as ClusterStatus)
  }, [])

  // 运行态与二进制路径是组件状态接口的权威字段，不能由前端按内核类型猜测。
  const refreshComponents = useCallback(async (targetId = nodeId) => {
    if (!targetId) return
    const result = await apiService.getComponentStates([targetId])
    if (result.success && result.data) setComponentStates(result.data.states)
  }, [nodeId])

  const detect = useCallback(async (targetId = nodeId) => {
    if (!targetId) return
    setBusy(`${targetId}:detect`)
    setError(null)
    try {
      setDetections(await apiService.detectKernels({ nodeId: targetId }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '运行时检测失败')
    } finally { setBusy(null) }
  }, [nodeId])

  useEffect(() => { refreshCluster().catch(() => {}) }, [refreshCluster])
  useEffect(() => { refreshComponents().catch(() => {}) }, [refreshComponents])
  useEffect(() => { if (nodeId && node?.agent?.deployed) detect(nodeId).catch(() => {}) }, [detect, node?.agent?.deployed, nodeId])

  const selectNode = (value: string) => {
    const next = new URLSearchParams(params)
    next.set('node', value)
    setParams(next)
    setDetections([])
    setComponentStates([])
  }

  const saveMonitoring = useCallback(async (kernels: NodeKernelConfig[]) => {
    if (!node) return
    setBusy(`${node.nodeId}:monitoring`)
    // 与 detect/maintain 保持一致：不清空旧错误会让上一次失败的提示滞留在本次操作上。
    setError(null)
    try {
      const result = await apiService.updateNodeKernels(node.nodeId, kernels)
      if (!result.success) throw new Error(result.error || '监控配置保存失败')
      setEditorOpen(false)
      toast.success('监控配置已写入远端并通过 Agent 验证')
      await refreshCluster()
      await refreshComponents(node.nodeId)
      await detect(node.nodeId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '监控配置保存失败')
    } finally { setBusy(null) }
  }, [detect, node, refreshCluster, refreshComponents])

  const maintain = useCallback(async (type: KernelType, action: 'start' | 'stop' | 'restart') => {
    if (!node) return
    setBusy(`${node.nodeId}:${type}:${action}`)
    setError(null)
    try {
      const result = await apiService.kernelAction(node.nodeId, type, action)
      if (!result.success) throw new Error(result.error || `${action} 失败`)
      toast.success(`${LABELS[type]} ${action} 完成`)
      await refreshComponents(node.nodeId)
      await detect(node.nodeId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '运行时维护失败')
    } finally { setBusy(null) }
  }, [detect, node, refreshComponents])

  return (
    <SignalPage crumb="Runtime operations" title="运行时" description="维护 mihomo 与协议核心的运行状态、配置路径和 Agent 监控范围。" status={node ? `${node.name} · ${detections.filter(item => item.installed).length} 个协议核心已安装` : '请选择节点'} maxWidth="narrow" actions={<Button variant="outline" onClick={() => detect()} disabled={!nodeId || busy !== null}><Icon icon={busy?.endsWith(':detect') ? 'ph:spinner-bold' : 'ph:magnifying-glass-light'} className={busy?.endsWith(':detect') ? 'animate-spin' : ''} />检测运行时</Button>}>
      {/* 对话框打开时错误已在对话框内展示；页面级告警会被模态层遮挡，重复渲染只会制造看不见的噪音。 */}
      {error && !editorOpen ? <Alert variant="destructive"><AlertTitle>运行时操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

      <Card className="mb-5">
        <CardHeader className="md:flex-row md:items-end md:justify-between"><div><CardTitle>目标节点</CardTitle><CardDescription>运行维护只作用于一个明确节点。</CardDescription></div><div className="min-w-[260px]"><Select aria-label="目标节点" value={nodeId} onChange={event => selectNode(event.target.value)}><option value="">选择节点</option>{nodes.map(item => <option key={item.nodeId} value={item.nodeId}>{item.name} · {item.location}</option>)}</Select></div></CardHeader>
      </Card>

      {node ? <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>mihomo</CardTitle><CardDescription>Clash 转换与产物验证运行时</CardDescription></div><Badge variant={node.mihomoAvailable ? 'secondary' : 'outline'}>{node.mihomoAvailable ? '可用' : '未安装/未知'}</Badge></div></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl bg-[var(--surface-container)] p-4 text-sm"><span className="block text-muted-foreground">运行模式与版本</span><span className="mt-1 block font-medium">CLI 转换器（无需常驻服务） · {node.mihomoVersion || '版本未知'}</span></div>
            <div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link to={`/deploy?node=${encodeURIComponent(node.nodeId)}&component=mihomo`}>{node.mihomoAvailable ? '升级/修复/卸载' : '前往部署'}</Link></Button><Button asChild size="sm" variant="outline"><Link to="/subscription?mode=preflight">查看转换链路</Link></Button></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>Agent 监控配置</CardTitle><CardDescription>监控范围保存后原子写入远端并验证。</CardDescription></div><Badge variant={node.agent?.status === 'running' ? 'secondary' : 'destructive'}>{node.agent?.status === 'running' ? 'Agent 可用' : 'Agent 不可用'}</Badge></div></CardHeader>
          <CardContent className="space-y-4"><div className="flex flex-wrap gap-2">{node.configuredKernels.length ? node.configuredKernels.map(item => <Badge key={item.type} variant="outline">{LABELS[item.type]} · {item.configPath || '默认路径'}</Badge>) : <span className="text-sm text-muted-foreground">尚未监控任何协议核心</span>}</div><Button onClick={() => setEditorOpen(true)} disabled={!node.agent?.deployed || detections.length === 0}>编辑监控范围与路径</Button></CardContent>
        </Card>

        {KERNEL_TYPES.map(type => {
          const detected = detections.find(item => item.type === type)
          const runtime = node.kernels.find(item => item.type === type)
          const component = componentStates.find(item => item.nodeId === node.nodeId && item.component === type)
          const monitored = node.configuredKernels.some(item => item.type === type)
          return (
            <Card key={type}>
              <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{LABELS[type]}</CardTitle><CardDescription>{detected?.version || '尚未检测到版本'}</CardDescription></div><div className="flex gap-2"><Badge variant={detected?.installed ? 'secondary' : 'outline'}>{detected?.installed ? '已安装' : '未安装'}</Badge><Badge variant={monitored ? 'secondary' : 'outline'}>{monitored ? '已监控' : '未监控'}</Badge></div></div></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 text-sm"><div className="flex justify-between gap-4"><span className="text-muted-foreground">二进制路径</span><code className="break-all text-right">{component?.path || runtime?.binaryPath || detected?.binaryPath || '未上报'}</code></div><div className="flex justify-between gap-4"><span className="text-muted-foreground">配置路径</span><code className="break-all text-right">{node.configuredKernels.find(item => item.type === type)?.configPath || detected?.defaultConfigPath || '-'}</code></div><div className="flex justify-between gap-4"><span className="text-muted-foreground">运行状态</span><span>{component?.runtimeState || '未知'}</span></div><div className="flex justify-between gap-4"><span className="text-muted-foreground">可读状态</span><span>{runtime?.accessible ? '可读' : runtime?.error || '未知'}</span></div><div className="flex justify-between gap-4"><span className="text-muted-foreground">来源数量</span><span>{runtime?.nodesCount ?? '-'}</span></div></div>
                <div className="flex flex-wrap gap-2">
                  {detected?.installed ? <><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => maintain(type, 'start')}>启动</Button><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => maintain(type, 'stop')}>停止</Button><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => maintain(type, 'restart')}>重启</Button></> : null}
                  <Button asChild size="sm" variant="outline"><Link to={`/deploy?node=${encodeURIComponent(node.nodeId)}&component=${encodeURIComponent(type)}`}>{detected?.installed ? '升级/修复/卸载' : '前往部署'}</Link></Button>
                  <Button asChild size="sm" variant="outline"><Link to={`/logs?node=${encodeURIComponent(node.nodeId)}&component=${encodeURIComponent(type)}`}>查看日志</Link></Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div> : <Card><CardContent className="p-10 text-center text-muted-foreground">请先选择节点；如果没有节点，请先在节点页添加。</CardContent></Card>}

      {editorOpen && node ? <KernelDetectionDialog open detections={detections} monitored={node.configuredKernels} submitting={busy === `${node.nodeId}:monitoring`} error={error} confirmLabel="保存并验证监控配置" onCancel={() => setEditorOpen(false)} onConfirm={saveMonitoring} /> : null}
    </SignalPage>
  )
}
