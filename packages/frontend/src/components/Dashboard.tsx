import { Icon } from '@iconify/react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiService, type ApiStatus, type UpdateResult } from '@/lib/api'
import type { ClusterStatus } from '@/lib/types'
import { useBackendReachable } from '@/context/AppContext'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import SignalPage from '@/components/shared/SignalPage'

interface DashboardProps {
  initialCluster?: ClusterStatus | null
  initialStatus?: ApiStatus | null
  initialError?: string | null
}

const FILES = [
  { name: 'raw.txt', label: '原始链接', key: 'rawExists' },
  { name: 'subscription.txt', label: '订阅文件', key: 'subscriptionExists' },
  { name: 'clash.yaml', label: 'Clash 配置', key: 'clashExists' },
] as const

const workflow = [
  { label: '添加节点', href: '/nodes', icon: 'ph:plus-light' },
  { label: '部署 Agent', href: '/deploy', icon: 'ph:paper-plane-tilt-light' },
  { label: '更新订阅', href: '/subscription', icon: 'ph:arrows-clockwise-light' },
  { label: '验证输出', href: '/subscription', icon: 'ph:file-arrow-down-light' },
]

function formatDate(value?: string) {
  if (!value) return '尚未生成'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatBytes(value?: number) {
  if (!value) return '-'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value / 1024) + ' KB'
}

export default function Dashboard({ initialCluster = null, initialStatus = null, initialError = null }: DashboardProps) {
  const backendReachable = useBackendReachable()
  const [status, setStatus] = useState(initialStatus)
  const [cluster, setCluster] = useState(initialCluster)
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  const refresh = useCallback(async () => {
    const [nextStatus, nextCluster] = await Promise.all([
      apiService.getStatus(),
      apiService.getClusterStatus(),
    ])
    setStatus(nextStatus)
    if (nextCluster.success) setCluster(nextCluster.data as ClusterStatus)
  }, [])

  useEffect(() => {
    if (initialStatus !== null || initialCluster !== null) return
    refresh().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : '加载失败'
      setError(message)
    })
  }, [initialCluster, initialStatus, refresh])

  const handleUpdate = useCallback(async () => {
    setLoading(true)
    setError(null)
    setUpdateResult(null)
    try {
      const result = await apiService.updateSubscription()
      setUpdateResult(result)
      await refresh()
      if (result.success) toast.success('订阅更新完成', { description: `生成 ${result.nodesCount} 个节点` })
      else toast.error('订阅更新失败', { description: result.message })
    } catch (err) {
      const message = err instanceof Error ? err.message : '更新失败，请查看日志页定位原因'
      setError(message)
      toast.error('更新失败', { description: message })
    } finally {
      setLoading(false)
    }
  }, [refresh])

  const missingFiles = status ? FILES.filter(file => !status[file.key]) : FILES
  const remoteNodes = cluster?.nodes.filter(node => node.nodeId !== 'local') || []
  const undeployedNodes = remoteNodes.filter(node => !node.agent?.deployed)
  const configuredKernels = remoteNodes.flatMap(node => node.configuredKernels.map(config => ({ node, config })))
  const healthyKernels = configuredKernels.filter(({ node, config }) => {
    const runtime = node.kernels.find(kernel => kernel.type === config.type)
    return node.online && runtime?.monitored && runtime.accessible
  })
  const remoteAgentReady = remoteNodes.length > 0 && undeployedNodes.length === 0
  const readiness = [
    { label: '远端 Agent', ok: remoteAgentReady, desc: remoteNodes.length === 0 ? '尚未添加子节点' : undeployedNodes.length ? `${undeployedNodes.length} 个节点待部署` : '子节点 Agent 已部署' },
    { label: '子节点内核', ok: configuredKernels.length > 0 && healthyKernels.length === configuredKernels.length, desc: configuredKernels.length === 0 ? '等待子节点上报' : `${healthyKernels.length}/${configuredKernels.length} 可用` },
    { label: 'mihomo 转换', ok: Boolean(status?.mihomoAvailable), desc: status?.mihomoVersion || '未检测到版本' },
    { label: '文件写入', ok: missingFiles.length === 0, desc: missingFiles.length ? `缺少 ${missingFiles.map(file => file.name).join('、')}` : '输出产物可用' },
  ]

  return (
    <SignalPage
      crumb="Signal Room / overview"
      title="总览"
      description="订阅生成、节点生命周期和关键产物的当前状态。"
      status={`最近生成 ${formatDate(status?.clashLastUpdated || status?.subscriptionLastUpdated)}`}
      maxWidth="narrow"
      actions={(
        <>
          <Button onClick={handleUpdate} disabled={loading}>
            <Icon icon={loading ? 'ph:spinner-light' : 'ph:arrows-clockwise-light'} className={loading ? 'animate-spin' : ''} />
            {loading ? '更新中' : '立即更新订阅'}
          </Button>
          <Button asChild variant="outline">
            <a href="/subscription">
              输出产物中心
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--muted)]"><Icon icon="ph:arrow-up-right-light" /></span>
            </a>
          </Button>
        </>
      )}
    >
      {backendReachable === false ? (
        <Alert variant="destructive" className="mb-6 flex gap-3">
          <Icon icon="ph:warning-circle-light" className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div>
            <AlertTitle>仪表盘后端未运行</AlertTitle>
            <AlertDescription>
              当前为静态预览。请通过 CLI 启动完整仪表盘：<code className="rounded bg-destructive/10 px-1.5 py-0.5 text-sm">miobridge dashboard start</code>
            </AlertDescription>
          </div>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="mb-6 flex gap-3">
          <Icon icon="ph:warning-circle-light" className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div>
            <AlertTitle>状态异常</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
        </Alert>
      ) : null}

      {updateResult ? (
        <Alert variant={updateResult.success ? 'success' : 'destructive'} className="mb-6 flex gap-3">
          <Icon icon={updateResult.success ? 'ph:check-circle-light' : 'ph:x-circle-light'} className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div className="min-w-0">
            <AlertTitle>{updateResult.success ? '更新完成' : '更新失败'}</AlertTitle>
            <AlertDescription className="break-words">{updateResult.message}</AlertDescription>
          </div>
        </Alert>
      ) : null}

      <section className="grid min-w-0 gap-5 xl:grid-cols-[1.05fr_1.25fr]">
        <Card className="min-h-[322px]">
          <CardHeader>
            <CardDescription>主流程</CardDescription>
            <CardTitle className="text-[28px] leading-tight">从节点到可用订阅</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {workflow.map((step, index) => (
                <a key={step.label} href={step.href} className="group rounded-[22px] border border-[var(--border)] bg-[var(--surface-container)] p-4 transition-[transform,background-color] duration-700 ease-[var(--motion)] hover:-translate-y-1">
                  <div className="flex items-center justify-between">
                    <span className="signal-mono text-xs text-muted-foreground">0{index + 1}</span>
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--muted)] text-primary transition-transform duration-700 ease-[var(--motion)] group-hover:translate-x-1">
                      <Icon icon={step.icon} />
                    </span>
                  </div>
                  <p className="mt-6 text-lg font-semibold">{step.label}</p>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid min-w-0 gap-5 lg:grid-cols-[0.76fr_1fr]">
          <Card>
            <CardHeader>
              <CardDescription>订阅节点</CardDescription>
              <CardTitle className="signal-value signal-success">{status?.nodesCount ?? cluster?.totalProxies ?? 0}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 text-sm text-muted-foreground">
              <p>raw.txt / clash.yaml {missingFiles.length === 0 ? '已生成' : '待生成'}</p>
              <p>子节点在线 <span className="signal-mono text-foreground">{cluster ? `${cluster.onlineNodes}/${cluster.totalNodes}` : '-'}</span></p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>最近 24 小时延迟概览</CardDescription>
            </CardHeader>
            <CardContent>
              <svg className="h-[190px] w-full" viewBox="0 0 640 180" role="img" aria-label="延迟趋势示意">
                <path d="M12 136 C96 88,144 72,210 100 S310 138,354 62 S456 26,520 92 S598 132,628 64" fill="none" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" />
                <path d="M12 158 C82 94,150 104,214 120 S314 34,360 82 S454 100,520 86 S590 82,628 118" fill="none" stroke="var(--warning)" strokeWidth="4" strokeLinecap="round" opacity=".9" />
              </svg>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[1fr_1.32fr]">
        <Card>
          <CardHeader>
            <CardDescription>阻塞源</CardDescription>
            <CardTitle className="text-xl">下一步建议</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {readiness.map(item => (
              <div key={item.label} className="flex items-center justify-between gap-4 rounded-[20px] bg-[var(--surface-container)] p-4">
                <div>
                  <p className="font-medium">{item.label}</p>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </div>
                <Badge variant={item.ok ? 'secondary' : 'destructive'}>{item.ok ? '正常' : '处理'}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>输出产物</CardDescription>
            <CardTitle className="text-xl">可分发文件</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:hidden">
              {FILES.map(file => (
                <div key={file.name} className="rounded-[20px] border border-[var(--border)] bg-[var(--surface-container)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{file.label}</p>
                      <p className="signal-mono mt-1 truncate text-xs text-muted-foreground">/{file.name}</p>
                    </div>
                    <Badge variant={status?.[file.key] ? 'secondary' : 'destructive'}>{status?.[file.key] ? '可用' : '缺失'}</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">大小</p>
                      <p className="signal-mono">{file.name === 'clash.yaml' ? formatBytes(status?.clashSize) : formatBytes(status?.subscriptionSize)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">更新时间</p>
                      <p>{formatDate(file.name === 'clash.yaml' ? status?.clashLastUpdated : status?.subscriptionLastUpdated)}</p>
                    </div>
                  </div>
                  <Button asChild size="sm" variant="outline" className="mt-4 w-full"><a href={apiService.getDownloadUrl(file.name)} target="_blank" rel="noreferrer">下载</a></Button>
                </div>
              ))}
            </div>
            <div className="hidden min-w-0 overflow-x-auto sm:block">
              <table className="signal-table min-w-[680px]">
                <thead>
                  <tr><th>产物</th><th>状态</th><th>大小</th><th>更新时间</th><th>操作</th></tr>
                </thead>
                <tbody>
                  {FILES.map(file => (
                    <tr key={file.name}>
                      <td><span className="font-medium">{file.label}</span><br /><span className="signal-mono text-xs text-muted-foreground">/{file.name}</span></td>
                      <td><Badge variant={status?.[file.key] ? 'secondary' : 'destructive'}>{status?.[file.key] ? '可用' : '缺失'}</Badge></td>
                      <td className="signal-mono">{file.name === 'clash.yaml' ? formatBytes(status?.clashSize) : formatBytes(status?.subscriptionSize)}</td>
                      <td>{formatDate(file.name === 'clash.yaml' ? status?.clashLastUpdated : status?.subscriptionLastUpdated)}</td>
                      <td><Button asChild size="sm" variant="outline"><a href={apiService.getDownloadUrl(file.name)} target="_blank" rel="noreferrer">下载</a></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </SignalPage>
  )
}
