import { Icon } from '@iconify/react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ApiStatus } from '@/lib/api'
import type { ClusterStatus } from '@/lib/types'
import { useClusterStatus, useMetrics, useStatus } from '@/lib/queries'
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
  { label: '添加节点', href: '/nodes?intent=add', icon: 'ph:plus-light' },
  { label: '部署运行环境', href: '/deploy', icon: 'ph:paper-plane-tilt-light' },
  { label: '生成订阅', href: '/subscription', icon: 'ph:arrows-clockwise-light' },
  { label: '维护订阅状态', href: '/subscription-status', icon: 'ph:shield-check-light' },
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
  const [metricRange, setMetricRange] = useState<'24h' | '7d' | '30d'>('24h')

  // 传入初始数据时（静态预览）挂载不自动拉取；否则三条查询各自加载。
  // Sidebar 也调用 useStatus()，同 key 合并为单请求；指标按 range 分 key 缓存，
  // 切换窗口时旧窗口的迟到响应写入的是旧 key，不会覆盖当前窗口——竞态由 key 天然消解。
  const live = initialStatus === null && initialCluster === null
  const statusQuery = useStatus({ enabled: live, ...(initialStatus ? { initialData: initialStatus } : {}) })
  const clusterQuery = useClusterStatus({ enabled: live, ...(initialCluster ? { initialData: initialCluster } : {}) })
  const metricsQuery = useMetrics(metricRange, { enabled: live })

  const status = statusQuery.data ?? null
  const cluster = (clusterQuery.data ?? null) as ClusterStatus | null
  const metrics = metricsQuery.data ?? null
  const error = initialError
    ?? (statusQuery.error ?? clusterQuery.error ?? metricsQuery.error)?.message
    ?? null

  const runRefresh = useCallback(() => {
    void statusQuery.refetch()
    void clusterQuery.refetch()
    void metricsQuery.refetch()
  }, [statusQuery, clusterQuery, metricsQuery])

  const missingFiles = status ? FILES.filter(file => !status[file.key]) : FILES
  const managedNodes = cluster?.nodes || []
  const undeployedNodes = managedNodes.filter(node => !node.agent?.deployed)
  const configuredKernels = managedNodes.flatMap(node => node.configuredKernels.map(config => ({ node, config })))
  const healthyKernels = configuredKernels.filter(({ node, config }) => {
    const runtime = node.kernels.find(kernel => kernel.type === config.type)
    return node.online && runtime?.monitored && runtime.accessible
  })
  const agentReady = managedNodes.length > 0 && undeployedNodes.length === 0
  const readiness = [
    { label: '节点 Agent', ok: agentReady, desc: managedNodes.length === 0 ? '尚未添加节点' : undeployedNodes.length ? `${undeployedNodes.length} 个节点待部署` : '所有节点 Agent 已部署' },
    { label: '节点内核', ok: configuredKernels.length > 0 && healthyKernels.length === configuredKernels.length, desc: configuredKernels.length === 0 ? '等待节点上报' : `${healthyKernels.length}/${configuredKernels.length} 可用` },
    { label: 'mihomo 转换', ok: Boolean(status?.mihomoAvailable), desc: status?.mihomoAvailable ? status.mihomoVersion || '版本未知' : '服务器未安装；运行 miobridge setup --yes' },
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
          <Button variant="outline" onClick={runRefresh}><Icon icon="ph:arrow-clockwise-light" />刷新摘要</Button>
          <Button asChild variant="outline">
            <Link to="/subscription">
              前往订阅生成
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--muted)]"><Icon icon="ph:arrow-up-right-light" /></span>
            </Link>
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

      <section className="grid min-w-0 gap-5 xl:grid-cols-[1.05fr_1.25fr]">
        <Card className="min-h-[322px]">
          <CardHeader>
            <CardDescription>主流程</CardDescription>
            <CardTitle className="text-[28px] leading-tight">从节点到可用订阅</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {workflow.map((step, index) => (
                <Link key={step.label} to={step.href} className="group rounded-[22px] border border-[var(--border)] bg-[var(--surface-container)] p-4 transition-[transform,background-color] duration-700 ease-[var(--motion)] hover:-translate-y-1">
                  <div className="flex items-center justify-between">
                    <span aria-hidden="true" className="signal-mono text-xs text-muted-foreground">0{index + 1}</span>
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--muted)] text-primary transition-transform duration-700 ease-[var(--motion)] group-hover:translate-x-1">
                      <Icon icon={step.icon} />
                    </span>
                  </div>
                  <p className="mt-6 text-lg font-semibold">{step.label}</p>
                </Link>
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
              <p>节点在线 <span className="signal-mono text-foreground">{cluster ? `${cluster.onlineNodes}/${cluster.totalNodes}` : '-'}</span></p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardDescription>指标趋势窗口</CardDescription><div className="flex gap-1">{(['24h', '7d', '30d'] as const).map(range => <Button key={range} size="sm" variant={metricRange === range ? 'default' : 'outline'} onClick={() => setMetricRange(range)}>{range}</Button>)}</div></div></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-2xl bg-[var(--surface-container)] p-4"><p className="text-xs text-muted-foreground">Agent 在线率</p><p className="signal-value mt-2 text-3xl">{metrics?.summary.agentOnlineRate ?? '—'}{metrics?.summary.agentOnlineRate !== null && metrics ? '%' : ''}</p></div>
              <div className="rounded-2xl bg-[var(--surface-container)] p-4"><p className="text-xs text-muted-foreground">订阅生成成功率</p><p className="signal-value mt-2 text-3xl">{metrics?.summary.subscriptionSuccessRate ?? '—'}{metrics?.summary.subscriptionSuccessRate !== null && metrics ? '%' : ''}</p></div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mt-5">
        <Card><CardHeader><div className="flex flex-wrap items-end justify-between gap-3"><div><CardDescription>{metricRange} 真实运行记录</CardDescription><CardTitle className="text-xl">部署、来源与产物趋势</CardTitle></div><span className="text-xs text-muted-foreground">{metrics?.history.length || 0} 个快照样本</span></div></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[
          ['部署成功率', metrics?.summary.deploymentSuccessRate, '%'],
          ['平均部署耗时', metrics?.summary.deploymentAverageDurationMs === null || metrics?.summary.deploymentAverageDurationMs === undefined ? null : Math.round(metrics.summary.deploymentAverageDurationMs / 1000), ' 秒'],
          ['来源成功率', metrics?.summary.sourceSuccessRate, '%'],
          ['订阅成功率', metrics?.summary.subscriptionSuccessRate, '%'],
          ['产物最大年龄', metrics?.summary.artifactMaximumAgeSeconds === null || metrics?.summary.artifactMaximumAgeSeconds === undefined ? null : Math.round(metrics.summary.artifactMaximumAgeSeconds / 60), ' 分钟'],
        ].map(([label, value, suffix]) => <div key={String(label)} className="rounded-2xl bg-[var(--surface-container)] p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value ?? '—'}{value !== null && value !== undefined ? suffix : ''}</p></div>)}<div className="rounded-2xl bg-[var(--surface-container)] p-4 sm:col-span-2 xl:col-span-5"><p className="text-xs text-muted-foreground">部署步骤平均耗时</p><div className="mt-3 flex flex-wrap gap-2">{Object.entries(metrics?.summary.deploymentStepAverageDurationMs || {}).map(([step, duration]) => <Badge key={step} variant="outline">{step} · {duration === null ? '—' : `${Math.round(duration / 1000)} 秒`}</Badge>)}{Object.keys(metrics?.summary.deploymentStepAverageDurationMs || {}).length === 0 ? <span className="text-sm text-muted-foreground">窗口内暂无完成任务</span> : null}</div></div></CardContent></Card>
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
                  <Button asChild size="sm" variant="outline" className="mt-4 w-full"><Link to="/outputs">前往衍生输出</Link></Button>
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
                      <td><Button asChild size="sm" variant="outline"><Link to="/outputs">查看</Link></Button></td>
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
