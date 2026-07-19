import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { apiService } from '@/lib/api'
import type { ClusterStatus, NodeStatus } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import SignalPage from '@/components/shared/SignalPage'

function statusLabel(node: NodeStatus) {
  if (!node.agent?.deployed) return '未安装'
  if (node.agent.status === 'running') return '运行中'
  if (node.agent.status === 'stopped') return '已停止'
  if (node.agent.status === 'deploying') return '部署中'
  return '异常'
}

export default function AgentsPage() {
  const [searchParams] = useSearchParams()
  const focusNode = searchParams.get('node')
  const [cluster, setCluster] = useState<ClusterStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await apiService.getClusterStatus()
    if (result.success) setCluster(result.data as ClusterStatus)
  }, [])

  useEffect(() => { refresh().catch(caught => setError(caught instanceof Error ? caught.message : 'Agent 状态加载失败')) }, [refresh])
  const nodes = useMemo(() => (cluster?.nodes || []).filter(node => node.nodeId !== 'local').sort((a, b) => Number(b.nodeId === focusNode) - Number(a.nodeId === focusNode)), [cluster?.nodes, focusNode])

  const run = useCallback(async (node: NodeStatus, action: 'start' | 'stop' | 'restart' | 'health') => {
    setBusy(`${node.nodeId}:${action}`)
    setError(null)
    try {
      const response = action === 'start' ? await apiService.startAgent(node.nodeId)
        : action === 'stop' ? await apiService.stopAgent(node.nodeId)
        : action === 'restart' ? await apiService.restartAgent(node.nodeId)
        : await apiService.clusterHealthCheck(node.nodeId)
      if (!response.success) throw new Error(response.error || `${action} 失败`)
      toast.success(action === 'health' ? '健康检查完成' : 'Agent 维护操作完成', { description: node.name })
      await refresh()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Agent 操作失败'
      setError(message)
      toast.error('Agent 操作失败', { description: message })
    } finally { setBusy(null) }
  }, [refresh])

  return (
    <SignalPage crumb="Agent lifecycle" title="Agent 维护" description="维护已安装监控程序的运行生命周期；安装态变更统一前往部署中心。" status={`${nodes.filter(node => node.agent?.status === 'running').length}/${nodes.length} 运行中`} maxWidth="narrow" actions={<Button variant="outline" onClick={refresh}><Icon icon="ph:arrow-clockwise-light" />刷新</Button>}>
      {error ? <Alert variant="destructive"><AlertTitle>Agent 操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      <div className="grid gap-5 lg:grid-cols-2">
        {nodes.map(node => {
          const deployed = Boolean(node.agent?.deployed)
          const running = node.agent?.status === 'running'
          const stopped = node.agent?.status === 'stopped'
          return (
            <Card key={node.nodeId} className={node.nodeId === focusNode ? 'ring-2 ring-[var(--primary)]' : ''}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4"><div><CardTitle>{node.name}</CardTitle><CardDescription>{node.location} · {node.nodeId}</CardDescription></div><Badge variant={running ? 'secondary' : deployed ? 'destructive' : 'outline'}>{statusLabel(node)}</Badge></div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-[var(--surface-container)] p-3"><span className="block text-xs text-muted-foreground">版本</span><span className="mt-1 block font-mono">{node.agent?.version || '-'}</span></div>
                  <div className="rounded-2xl bg-[var(--surface-container)] p-3"><span className="block text-xs text-muted-foreground">监听端口</span><span className="mt-1 block font-mono">{deployed ? node.agent?.port || 3001 : '-'}</span></div>
                  <div className="rounded-2xl bg-[var(--surface-container)] p-3"><span className="block text-xs text-muted-foreground">心跳延迟</span><span className="mt-1 block font-mono">{node.latency ? `${node.latency}ms` : '-'}</span></div>
                  <div className="rounded-2xl bg-[var(--surface-container)] p-3"><span className="block text-xs text-muted-foreground">运行时间</span><span className="mt-1 block font-mono">{node.uptime ? `${Math.floor(node.uptime / 60)}m` : '-'}</span></div>
                  <div className="rounded-2xl bg-[var(--surface-container)] p-3"><span className="block text-xs text-muted-foreground">健康状态</span><span className="mt-1 block">{node.online ? '心跳正常' : deployed ? '心跳中断' : '-'}</span></div>
                  <div className="rounded-2xl bg-[var(--surface-container)] p-3"><span className="block text-xs text-muted-foreground">最近部署</span><span className="mt-1 block">{node.agent?.lastDeploy ? new Date(node.agent.lastDeploy).toLocaleString('zh-CN') : '-'}</span></div>
                  {/* PRD 要求即使节点已恢复也保留最近一次失败原因，作为进入排障链路的入口。 */}
                  <div className="col-span-2 rounded-2xl bg-[var(--surface-container)] p-3"><span className="block text-xs text-muted-foreground">最近错误</span><span className="mt-1 block break-all">{node.lastError || node.error || '无'}</span></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!deployed ? <Button asChild size="sm"><Link to={`/deploy?node=${encodeURIComponent(node.nodeId)}&component=agent&operation=install`}>前往部署</Link></Button> : null}
                  {stopped ? <Button size="sm" disabled={busy !== null} onClick={() => run(node, 'start')}>启动</Button> : null}
                  {running ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run(node, 'stop')}>停止</Button> : null}
                  {deployed ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run(node, 'restart')}>重启</Button> : null}
                  {deployed ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run(node, 'health')}>立即健康检查</Button> : null}
                  {deployed ? <Button asChild size="sm" variant="outline"><Link to={`/deploy?node=${encodeURIComponent(node.nodeId)}&component=agent&operation=repair`}>修复/升级/卸载</Link></Button> : null}
                  <Button asChild size="sm" variant="outline"><Link to={`/logs?node=${encodeURIComponent(node.nodeId)}`}>查看日志</Link></Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
        {nodes.length === 0 ? <Card><CardContent className="p-10 text-center text-muted-foreground">暂无远端节点。请先在节点页创建节点档案。</CardContent></Card> : null}
      </div>
    </SignalPage>
  )
}
