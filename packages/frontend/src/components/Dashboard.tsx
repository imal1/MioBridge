import { Icon } from '@iconify/react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import type { ApiStatus } from '@/lib/api'
import type { ArtifactState, ClusterStatus } from '@/lib/types'
import { apiService } from '@/lib/api'
import {
  useArtifacts, useClusterStatus, useComponentDeployments, useMetrics, useStatus, useValidateArtifacts,
} from '@/lib/queries'
import { useBackendReachable, useConvertModal } from '@/context/AppContext'
import PageHeader from '@/components/shared/PageHeader'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface DashboardProps {
  initialCluster?: ClusterStatus | null
  initialStatus?: ApiStatus | null
  initialError?: string | null
}

const FILES = [
  { name: 'raw.txt', label: '原始链接', key: 'rawExists' },
  { name: 'subscription.txt', label: 'Base64 订阅', key: 'subscriptionExists' },
  { name: 'clash.yaml', label: 'Clash 配置', key: 'clashExists' },
] as const

const ARTIFACT_LABEL: Record<string, string> = {
  'raw.txt': '原始链接',
  'subscription.txt': 'Base64 订阅',
  'clash.yaml': 'Clash 配置',
}

function freshnessLabel(value: ArtifactState['freshness']) {
  return value === 'fresh' ? '新鲜' : value === 'expiring' ? '即将过期' : value === 'stale' ? '已过期' : '无效'
}

function freshnessTone(item: ArtifactState): 'success' | 'warning' | 'danger' {
  if (!item.valid) return 'danger'
  if (item.freshness === 'fresh') return 'success'
  return 'warning'
}

function formatDate(value?: string) {
  if (!value) return '尚未生成'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function formatBytes(value?: number) {
  if (!value) return '-'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value / 1024) + ' KB'
}

const toneColor = { success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', info: 'var(--foreground)' } as const

function StatCell({ label, value, sub, color }: { label: string; value: string | number; sub: string; color: string }) {
  return (
    <div className="mb-card" style={{ padding: '14px 16px' }}>
      <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: 'var(--muted-foreground)' }}>{label}</p>
      <p className="signal-mono" style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 600, color }}>{value}</p>
      <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'var(--muted-foreground)' }}>{sub}</p>
    </div>
  )
}

const RANGES = ['24h', '7d', '30d'] as const

export default function Dashboard({ initialCluster = null, initialStatus = null, initialError = null }: DashboardProps) {
  const backendReachable = useBackendReachable()
  const { open: openConvertModal } = useConvertModal()
  const [metricRange, setMetricRange] = useState<(typeof RANGES)[number]>('24h')

  const live = initialStatus === null && initialCluster === null
  const statusQuery = useStatus({ enabled: live, ...(initialStatus ? { initialData: initialStatus } : {}) })
  const clusterQuery = useClusterStatus({ enabled: live, ...(initialCluster ? { initialData: initialCluster } : {}) })
  const metricsQuery = useMetrics(metricRange, { enabled: live })
  const artifactsQuery = useArtifacts({ enabled: live })
  const deploymentsQuery = useComponentDeployments(undefined, { enabled: live })
  const validateArtifacts = useValidateArtifacts()

  const status = statusQuery.data ?? null
  const cluster = (clusterQuery.data ?? null) as ClusterStatus | null
  const metrics = metricsQuery.data ?? null
  const artifacts = artifactsQuery.data ?? []
  const tasks = Object.values(deploymentsQuery.data ?? {})
  const activeTasks = tasks.filter(t => t.status === 'running' || t.status === 'pending')
  const error = initialError ?? (statusQuery.error ?? clusterQuery.error ?? metricsQuery.error)?.message ?? null

  const [preview, setPreview] = useState<{ name: string; content: string; truncated: boolean } | null>(null)
  const [checking, setChecking] = useState(false)

  // Readiness (preserved from prior overview logic).
  const missingFiles = status ? FILES.filter(f => !status[f.key]) : FILES
  const managedNodes = cluster?.nodes || []
  const undeployedNodes = managedNodes.filter(n => !n.agent?.deployed)
  const configuredKernels = managedNodes.flatMap(n => n.configuredKernels.map(c => ({ node: n, config: c })))
  const healthyKernels = configuredKernels.filter(({ node, config }) => {
    const runtime = node.kernels.find(k => k.type === config.type)
    return node.online && runtime?.monitored && runtime.accessible
  })
  const agentReady = managedNodes.length > 0 && undeployedNodes.length === 0
  const readiness = [
    { label: '节点 Agent', ok: agentReady, desc: managedNodes.length === 0 ? '尚未添加节点' : undeployedNodes.length ? `${undeployedNodes.length} 个节点待部署` : '所有节点 Agent 已部署' },
    { label: '节点内核', ok: configuredKernels.length > 0 && healthyKernels.length === configuredKernels.length, desc: configuredKernels.length === 0 ? '等待节点上报' : `${healthyKernels.length}/${configuredKernels.length} 可用` },
    { label: 'mihomo 转换', ok: Boolean(status?.mihomoAvailable), desc: status?.mihomoAvailable ? status.mihomoVersion || '版本未知' : '服务器未安装；运行 miobridge setup --yes' },
    { label: '文件写入', ok: missingFiles.length === 0, desc: missingFiles.length ? `缺少 ${missingFiles.map(f => f.name).join('、')}` : '三个输出产物均可用' },
  ]

  const offline = cluster ? cluster.totalNodes - cluster.onlineNodes : 0
  const statCells = [
    { label: '订阅节点', value: status?.nodesCount ?? cluster?.totalProxies ?? 0, sub: missingFiles.length === 0 ? 'raw.txt / clash.yaml 已生成' : '产物待生成', color: toneColor.success },
    { label: '节点在线', value: cluster ? `${cluster.onlineNodes}/${cluster.totalNodes}` : '—', sub: offline > 0 ? `${offline} 个节点心跳中断` : '全部在线', color: offline > 0 ? toneColor.warning : toneColor.success },
    { label: '活动任务', value: activeTasks.length, sub: activeTasks[0] ? `${activeTasks[0].nodeId} · ${activeTasks[0].component}` : '无进行中任务', color: toneColor.info },
    { label: '来源', value: metrics?.snapshot.sources ?? '—', sub: '预检与就绪状态见订阅页', color: toneColor.info },
  ]

  const metricCells = [
    ['Agent 在线率', metrics?.summary.agentOnlineRate, '%'],
    ['订阅成功率', metrics?.summary.subscriptionSuccessRate, '%'],
    ['部署成功率', metrics?.summary.deploymentSuccessRate, '%'],
    ['平均部署耗时', metrics?.summary.deploymentAverageDurationMs == null ? null : Math.round(metrics.summary.deploymentAverageDurationMs / 1000), ' 秒'],
  ] as const

  const copyUrl = useCallback(async (name: string) => {
    const url = new URL(`/${name}`, window.location.origin).toString()
    await navigator.clipboard.writeText(url)
    toast.success('已复制公共产物 URL', { description: url })
  }, [])

  const openPreview = useCallback(async (name: ArtifactState['name']) => {
    const response = await apiService.previewArtifact(name)
    if (response.success && response.data) setPreview(response.data)
    else toast.error('产物预览失败')
  }, [])

  const validate = useCallback(async () => {
    setChecking(true)
    try {
      const response = await validateArtifacts.mutateAsync(undefined)
      const invalid = response.data?.artifacts.filter(i => !i.valid).length || 0
      if (invalid > 0) toast.warning(`${invalid} 个产物未通过验证`)
      else toast.success('三个正式产物均通过验证')
    } finally { setChecking(false) }
  }, [validateArtifacts])

  return (
    <>
      <PageHeader
        title="总览"
        description={`订阅生成、节点与产物的当前状态。最近生成 ${formatDate(status?.clashLastUpdated || status?.subscriptionLastUpdated)}。`}
        actions={(
          <>
            <Link to="/nodes" className="mb-pill-btn primary"><Icon icon="ph:plus-bold" />添加节点</Link>
            <Link to="/subscription" className="mb-pill-btn"><Icon icon="ph:arrows-clockwise-light" />生成订阅</Link>
          </>
        )}
      />

      {backendReachable === false ? (
        <div className="garden-alert garden-alert-danger" style={{ borderRadius: 14, marginBottom: 14 }}>
          <Icon icon="ph:warning-circle-light" className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">仪表盘后端未运行</p>
            <p className="text-xs">当前为静态预览。通过 CLI 启动完整仪表盘：<code>miobridge dashboard start</code></p>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="garden-alert garden-alert-danger" style={{ borderRadius: 14, marginBottom: 14 }}>
          <Icon icon="ph:warning-circle-light" className="mt-0.5 size-5 shrink-0" />
          <div><p className="font-semibold">状态异常</p><p className="text-xs">{error}</p></div>
        </div>
      ) : null}

      <section className="mb-[14px] grid gap-2.5" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        {statCells.map(c => <StatCell key={c.label} {...c} />)}
      </section>

      <section className="grid items-start gap-[14px]" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' }}>
        {/* 输出产物 */}
        <div className="mb-card overflow-hidden">
          <div className="flex items-center justify-between px-[18px] pb-2.5 pt-[14px]">
            <div>
              <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>输出产物</h2>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--muted-foreground)' }}>三个正式产物的状态与分发入口</p>
            </div>
            <button onClick={validate} disabled={checking} className="mb-pill-btn" style={{ height: 28, padding: '0 12px', fontSize: 11.5, borderRadius: 99 }}>
              {checking ? '验证中…' : '验证全部'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="mb-table" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th className="mb-th" style={{ padding: '6px 18px' }}>产物</th>
                  <th className="mb-th" style={{ padding: '6px 10px' }}>状态</th>
                  <th className="mb-th" style={{ padding: '6px 10px' }}>大小</th>
                  <th className="mb-th" style={{ padding: '6px 10px' }}>更新时间</th>
                  <th className="mb-th" style={{ padding: '6px 18px', textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {artifacts.map(item => {
                  const tone = freshnessTone(item)
                  return (
                    <tr key={item.name}>
                      <td style={{ padding: '9px 18px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontWeight: 600, fontSize: 12.5 }}>{ARTIFACT_LABEL[item.name] ?? item.name}</span><br />
                        <span className="signal-mono" style={{ fontSize: 10.5, color: 'var(--muted-foreground)' }}>/{item.name}</span>
                      </td>
                      <td style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 99, background: `var(--${tone}-bg)`, color: `var(--${tone})`, fontSize: 11, fontWeight: 600 }}>
                          <span style={{ width: 5, height: 5, borderRadius: 99, background: `var(--${tone})` }} />
                          {item.valid ? freshnessLabel(item.freshness) : '无效/缺失'}
                        </span>
                      </td>
                      <td className="signal-mono" style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', fontSize: 11.5 }}>{formatBytes(item.size)}</td>
                      <td style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--muted-foreground)' }}>{item.updatedAt ? formatDate(item.updatedAt) : '尚未生成'}</td>
                      <td style={{ padding: '9px 18px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <button onClick={() => copyUrl(item.name)} disabled={!item.exists} className="mb-pill-btn" style={{ height: 26, padding: '0 10px', fontSize: 11, borderRadius: 99 }}>复制 URL</button>
                          <button onClick={() => openPreview(item.name)} disabled={!item.exists} className="mb-pill-btn" style={{ height: 26, padding: '0 10px', fontSize: 11, borderRadius: 99 }}>预览</button>
                          <a href={item.exists ? apiService.getDownloadUrl(item.name) : undefined} download className="mb-pill-btn primary" style={{ height: 26, padding: '0 10px', fontSize: 11, borderRadius: 99, pointerEvents: item.exists ? undefined : 'none', opacity: item.exists ? 1 : 0.5 }}>下载</a>
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {artifacts.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 12 }}>产物状态尚未加载。</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 px-[18px] py-2.5" style={{ fontSize: 11.5, color: 'var(--muted-foreground)' }}>
            <Icon icon="ph:arrows-left-right-light" />需要临时转换外部订阅？
            <button onClick={openConvertModal} style={{ fontWeight: 600, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>打开临时转换器</button>
            （不会覆盖正式文件）
          </div>
        </div>

        {/* 就绪检查 + 运行指标 */}
        <div className="flex flex-col gap-[14px]">
          <div className="mb-card" style={{ padding: '14px 18px' }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 14.5, fontWeight: 700 }}>就绪检查</h2>
            <div className="flex flex-col gap-2">
              {readiness.map(r => (
                <div key={r.label} className="flex items-center gap-2.5">
                  <Icon icon={r.ok ? 'ph:check-circle-fill' : 'ph:warning-circle-fill'} style={{ fontSize: 16, color: r.ok ? 'var(--success)' : 'var(--warning)' }} />
                  <div className="min-w-0 flex-1">
                    <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{r.label}</p>
                    <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted-foreground)' }}>{r.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-card" style={{ padding: '14px 18px' }}>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>运行指标</h2>
              <div className="flex gap-1">
                {RANGES.map(r => {
                  const active = metricRange === r
                  return (
                    <button key={r} onClick={() => setMetricRange(r)} style={{ height: 24, padding: '0 10px', border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 99, background: active ? 'var(--success-bg)' : 'transparent', color: active ? 'var(--primary)' : 'var(--muted-foreground)', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{r}</button>
                  )
                })}
              </div>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {metricCells.map(([label, value, suffix]) => (
                <div key={label} style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--card2)' }}>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--muted-foreground)' }}>{label}</p>
                  <p className="signal-mono" style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 600 }}>{value ?? '—'}{value != null ? suffix : ''}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Dialog open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(null) }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{preview?.name} 预览</DialogTitle>
            <DialogDescription>{preview?.truncated ? '内容较长，当前只显示前 64 KiB。' : '当前正式发布内容。'}</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[65vh] overflow-auto rounded-2xl p-4 text-xs leading-6" style={{ background: 'var(--surface-container-high)' }}>{preview?.content}</pre>
        </DialogContent>
      </Dialog>
    </>
  )
}
