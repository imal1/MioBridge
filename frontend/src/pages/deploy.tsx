import type { GetServerSideProps } from 'next'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { toast } from 'sonner'
import { apiService } from '@/lib/api'
import type { ClusterStatus, DeployStatus } from '@/server/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import SignalPage from '@/components/shared/SignalPage'

interface DeployPageProps {
  initialCluster: ClusterStatus | null
  initialDeployments: Record<string, DeployStatus>
  initialError: string | null
}

const stepLabels: Record<string, string> = {
  connect: '连接',
  upload: '上传',
  install: '安装',
  configure: '配置',
  start: '启动',
  verify: '验证',
}

function statusVariant(status?: DeployStatus['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'success') return 'secondary'
  if (status === 'error') return 'destructive'
  if (status === 'running') return 'default'
  return 'outline'
}

function statusLabel(status?: DeployStatus['status']) {
  if (status === 'success') return '成功'
  if (status === 'error') return '失败'
  if (status === 'running') return '运行中'
  return '等待'
}

export default function DeployPage({ initialCluster, initialDeployments, initialError }: DeployPageProps) {
  const [cluster, setCluster] = useState(initialCluster)
  const [deployments, setDeployments] = useState(initialDeployments)
  const [error, setError] = useState<string | null>(initialError)
  const [busyNode, setBusyNode] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'running' | 'failed'>('all')

  const refresh = useCallback(async () => {
    const [clusterResult, deployResult] = await Promise.all([
      apiService.getClusterStatus(),
      apiService.getDeployStatus(),
    ])
    if (clusterResult.success) setCluster(clusterResult.data as ClusterStatus)
    if (deployResult.success) setDeployments((deployResult.data as any)?.deployments || {})
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      refresh().catch(() => {})
    }, 2000)
    return () => clearInterval(id)
  }, [refresh])

  const remoteNodes = useMemo(() => (cluster?.nodes || []).filter(node => node.nodeId !== 'local'), [cluster?.nodes])
  const visibleNodes = useMemo(() => {
    if (filter === 'running') return remoteNodes.filter(node => ['pending', 'running'].includes(deployments[node.nodeId]?.status || ''))
    if (filter === 'failed') return remoteNodes.filter(node => deployments[node.nodeId]?.status === 'error')
    return remoteNodes
  }, [deployments, filter, remoteNodes])
  const activeCount = Object.values(deployments).filter(item => item.status === 'running' || item.status === 'pending').length
  const failedCount = Object.values(deployments).filter(item => item.status === 'error').length
  const undeployedCount = remoteNodes.filter(node => !node.agent?.deployed).length

  const deployNode = useCallback(async (nodeId: string) => {
    setBusyNode(nodeId)
    setError(null)
    try {
      await apiService.deployNode(nodeId)
      await refresh()
      toast.success('部署已触发', { description: nodeId })
    } catch (err) {
      const message = err instanceof Error ? err.message : '部署失败，请查看日志'
      setError(message)
      toast.error('部署失败', { description: message })
    } finally {
      setBusyNode(null)
    }
  }, [refresh])

  return (
    <SignalPage
      crumb="Agent deployment"
      title="部署"
      description="跟踪 Agent 部署进度，重试未部署或失败的远端节点。"
      status="部署进度同步中"
      maxWidth="narrow"
      actions={(
        <Button variant="outline" onClick={refresh}>
          <Icon icon="ph:arrow-clockwise-light" />
          刷新
        </Button>
      )}
    >

      {error ? (
        <Alert variant="destructive" className="flex gap-3">
          <Icon icon="ph:warning-circle-bold" className="mt-0.5 h-5 w-5" />
          <div>
            <AlertTitle>部署操作失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
        </Alert>
      ) : null}

      <div className="grid gap-5 md:grid-cols-3">
        <Card variant="elevated"><CardHeader className="pb-3"><CardDescription>运行任务</CardDescription><CardTitle className="signal-value signal-success">{activeCount}</CardTitle></CardHeader></Card>
        <Card variant="elevated"><CardHeader className="pb-3"><CardDescription>未部署节点</CardDescription><CardTitle className="signal-value">{undeployedCount}</CardTitle></CardHeader></Card>
        <Card variant="elevated"><CardHeader className="pb-3"><CardDescription>失败任务</CardDescription><CardTitle className="signal-value signal-danger">{failedCount}</CardTitle></CardHeader></Card>
      </div>

      <Card className="mt-5">
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-xl">部署任务</CardTitle>
            <CardDescription>部署状态由服务端内存进度存储提供，页面会自动轮询刷新。</CardDescription>
          </div>
          <Tabs value={filter} onValueChange={value => setFilter(value as typeof filter)}>
            <TabsList>
              <TabsTrigger value="all">全部</TabsTrigger>
              <TabsTrigger value="running">运行中</TabsTrigger>
              <TabsTrigger value="failed">失败</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:hidden">
            {visibleNodes.map(node => {
              const deployment = deployments[node.nodeId]
              return (
                <article key={node.nodeId} className="rounded-[20px] border border-[var(--border)] bg-[var(--surface-container)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{node.name}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{node.location} · {node.nodeId}</p>
                    </div>
                    <Badge variant={statusVariant(deployment?.status)}>{statusLabel(deployment?.status)}</Badge>
                  </div>
                  <div className="mt-4 grid gap-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">步骤</span>
                      <span className="font-medium">{deployment ? stepLabels[deployment.step] || deployment.step : '-'}</span>
                    </div>
                    <div>
                      <Progress value={deployment?.progress || 0} />
                      <span className="mt-1 block font-mono text-xs text-muted-foreground">{deployment?.progress || 0}%</span>
                    </div>
                    <p className="break-words text-sm text-muted-foreground">{deployment?.message || (node.agent?.deployed ? '已部署' : '等待部署')}</p>
                  </div>
                  <Button className="mt-4 w-full" size="sm" disabled={busyNode === node.nodeId || deployment?.status === 'running'} onClick={() => deployNode(node.nodeId)}>
                    <Icon icon={busyNode === node.nodeId ? 'ph:spinner-bold' : 'ph:rocket-launch-bold'} className={busyNode === node.nodeId ? 'animate-spin' : ''} />
                    {node.agent?.deployed ? '重新部署' : '部署'}
                  </Button>
                </article>
              )
            })}
            {visibleNodes.length === 0 ? (
              <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface-container)] p-8 text-center text-muted-foreground">暂无远端节点</div>
            ) : null}
          </div>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>节点</TableHead>
                  <TableHead>步骤</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>进度</TableHead>
                  <TableHead>消息</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleNodes.map(node => {
                  const deployment = deployments[node.nodeId]
                  return (
                    <TableRow key={node.nodeId}>
                      <TableCell>
                        <span className="block font-medium">{node.name}</span>
                        <span className="block text-xs text-muted-foreground">{node.location} · {node.nodeId}</span>
                      </TableCell>
                      <TableCell>{deployment ? stepLabels[deployment.step] || deployment.step : '-'}</TableCell>
                      <TableCell><Badge variant={statusVariant(deployment?.status)}>{statusLabel(deployment?.status)}</Badge></TableCell>
                      <TableCell className="min-w-[160px]">
                        <Progress value={deployment?.progress || 0} />
                        <span className="mt-1 block font-mono text-xs text-muted-foreground">{deployment?.progress || 0}%</span>
                      </TableCell>
                      <TableCell className="max-w-md break-words text-sm text-muted-foreground">{deployment?.message || (node.agent?.deployed ? '已部署' : '等待部署')}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" disabled={busyNode === node.nodeId || deployment?.status === 'running'} onClick={() => deployNode(node.nodeId)}>
                          <Icon icon={busyNode === node.nodeId ? 'ph:spinner-bold' : 'ph:rocket-launch-bold'} className={busyNode === node.nodeId ? 'animate-spin' : ''} />
                          {node.agent?.deployed ? '重新部署' : '部署'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {visibleNodes.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">暂无远端节点</TableCell></TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </SignalPage>
  )
}

export const getServerSideProps: GetServerSideProps<DeployPageProps> = async () => {
  try {
    const { NodeManager } = await import('@/server/services/nodeManager')
    const { getAllDeployStatuses } = await import('@/server/services/deployProgressStore')
    const cluster = await NodeManager.getInstance().getClusterStatus()
    const deployments: Record<string, DeployStatus> = {}
    for (const status of getAllDeployStatuses()) deployments[status.nodeId] = status
    return { props: { initialCluster: JSON.parse(JSON.stringify(cluster)), initialDeployments: JSON.parse(JSON.stringify(deployments)), initialError: null } }
  } catch (error) {
    return { props: { initialCluster: null, initialDeployments: {}, initialError: error instanceof Error ? error.message : '获取部署状态失败' } }
  }
}
