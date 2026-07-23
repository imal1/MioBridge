import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '@iconify/react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { apiService } from '@/lib/api'
import { streamServerEvents } from '@/lib/sse'
import {
  queryKeys, useArtifacts, useClusterStatus, useRetrySubscriptionJob, useStartSubscriptionJob,
  useStatus, useSubscriptionJobs, useSubscriptionPolicy, useSubscriptionPreflight, useUpdateSubscriptionPolicy,
} from '@/lib/queries'
import type { ArtifactState, SubscriptionJob, SubscriptionPolicy } from '@/lib/types'
import PageHeader from '@/components/shared/PageHeader'

const STEP_LABELS: Record<SubscriptionJob['step'], string> = {
  collect: '采集', parse: '解析', deduplicate: '去重', encode: '编码', convert: 'mihomo 转换',
  validate: '验证', publish: '原子发布', backup: '备份', done: '完成',
}
const ARTIFACT_LABEL: Record<string, string> = { 'raw.txt': 'raw.txt', 'subscription.txt': 'subscription.txt', 'clash.yaml': 'clash.yaml' }

function message(value: unknown, fallback: string) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') return value.message
  return fallback
}
function freshnessLabel(v: ArtifactState['freshness']) {
  return v === 'fresh' ? '新鲜' : v === 'expiring' ? '即将过期' : v === 'stale' ? '已过期' : '无效'
}
function formatBytes(v?: number) { return v ? `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(v / 1024)} KB` : '-' }

function jobTone(job: SubscriptionJob): 'success' | 'warning' | 'danger' | 'muted' {
  if (job.status === 'succeeded') return 'success'
  if (job.status === 'partial') return 'warning'
  if (job.status === 'failed') return 'danger'
  return 'muted'
}
function jobStatusText(job: SubscriptionJob) {
  return job.status === 'succeeded' ? '成功' : job.status === 'partial' ? '部分成功' : job.status === 'failed' ? '失败' : job.status === 'queued' ? '排队中' : '生成中'
}

export default function SubscriptionPage() {
  const queryClient = useQueryClient()
  const pollOptions = { refetchInterval: 5000, refetchIntervalInBackground: false } as const
  const clusterQuery = useClusterStatus(pollOptions)
  const preflightQuery = useSubscriptionPreflight(pollOptions)
  const jobsQuery = useSubscriptionJobs(pollOptions)
  const artifactsQuery = useArtifacts()
  const statusQuery = useStatus()
  const policyQuery = useSubscriptionPolicy()
  const updatePolicy = useUpdateSubscriptionPolicy()
  const startJob = useStartSubscriptionJob()
  const retryJob = useRetrySubscriptionJob()

  const cluster = clusterQuery.data ?? null
  const preflight = preflightQuery.data ?? null
  const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data])
  const artifacts = artifactsQuery.data ?? []
  const status = statusQuery.data ?? null

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamBroken, setStreamBroken] = useState(false)
  const [streamAttempt, setStreamAttempt] = useState(0)

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.clusterStatus }),
      queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionPreflight }),
      queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionJobs }),
    ])
  }, [queryClient])

  const activeJobs = useMemo(() => jobs.filter(j => j.status === 'queued' || j.status === 'running'), [jobs])
  useEffect(() => {
    if (!activeJobs.length) { setStreamBroken(false); return }
    const controllers = activeJobs.map(job => {
      const controller = new AbortController()
      streamServerEvents(`/api/subscription-jobs/${encodeURIComponent(job.id)}/events`, {
        signal: controller.signal,
        onMessage: () => { setStreamBroken(false); refresh().catch(() => {}) },
      }).catch(() => { if (!controller.signal.aborted) setStreamBroken(true) })
      return controller
    })
    return () => controllers.forEach(c => c.abort())
  }, [activeJobs.map(j => j.id).join(','), refresh, streamAttempt])

  const generate = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const check = await apiService.preflightSubscription()
      if (!check.success || !check.data?.ready) throw new Error(check.data?.blockingErrors.join('；') || message(check.error, '没有可读来源'))
      const response = await startJob.mutateAsync()
      if (!response.success) throw new Error(message(response.error, '创建订阅任务失败'))
      toast.success('订阅任务已持久化并进入队列', { description: response.data?.jobId })
    } catch (caught) { const d = caught instanceof Error ? caught.message : '创建订阅任务失败'; setError(d); toast.error('订阅生成未启动', { description: d }) }
    finally { setLoading(false) }
  }, [startJob])

  const retry = useCallback(async (job: SubscriptionJob) => {
    try {
      const response = await retryJob.mutateAsync(job.id)
      if (!response.success) throw new Error(message(response.error, '无法按原输入重试'))
      toast.success('已按上次输入创建重试任务')
    } catch (caught) { const d = caught instanceof Error ? caught.message : '无法按原输入重试'; setError(d); toast.error('任务重试失败', { description: d }) }
  }, [retryJob])

  // ---- schedule policy (local editable copy) ----
  const [policy, setPolicy] = useState<SubscriptionPolicy | null>(null)
  useEffect(() => { if (policyQuery.data) setPolicy(policyQuery.data) }, [policyQuery.data])
  const savePolicy = useCallback(async () => {
    if (!policy) return
    try {
      const r = await updatePolicy.mutateAsync(policy)
      if (!r.success) throw new Error(message(r.error, '策略保存失败'))
      toast.success('定时生成策略已保存')
    } catch (caught) { const d = caught instanceof Error ? caught.message : '策略保存失败'; setError(d); toast.error('策略保存失败', { description: d }) }
  }, [policy, updatePolicy])

  // ---- health checks ----
  const allExist = artifacts.length > 0 && artifacts.every(a => a.exists)
  const [last, prev] = jobs.filter(j => j.status === 'succeeded' || j.status === 'partial')
  const dropOk = !last || !prev || prev.nodesGenerated === 0 || (last.nodesGenerated - prev.nodesGenerated) / prev.nodesGenerated >= -((policy?.nodeDropPercent ?? 30) / 100)
  const checks = [
    ...artifacts.map(a => ({ label: ARTIFACT_LABEL[a.name] ?? a.name, detail: `${formatBytes(a.size)} · ${freshnessLabel(a.freshness)}`, ok: a.valid && a.freshness === 'fresh' })),
    { label: 'mihomo 转换器', detail: status?.mihomoAvailable ? status.mihomoVersion || '已安装' : '未安装', ok: Boolean(status?.mihomoAvailable) },
    { label: '公共兼容 URL', detail: '/raw.txt · /subscription.txt · /clash.yaml', ok: allExist },
    { label: '节点突降阈值', detail: last && prev ? `较上次 ${prev.nodesGenerated} → ${last.nodesGenerated}，阈值 ${policy?.nodeDropPercent ?? 30}%` : '暂无对比数据', ok: dropOk },
  ]

  const sourceNodes = cluster?.nodes || []

  return (
    <>
      <PageHeader
        title="订阅"
        description="生成、健康状态与定时策略。产物的预览与下载在总览页。"
        actions={(
          <button onClick={generate} disabled={loading || !preflight?.ready || activeJobs.length > 0} className="mb-pill-btn primary">
            <Icon icon="ph:play-circle-light" style={{ fontSize: 15 }} />{loading ? '创建中…' : activeJobs.length ? '生成任务执行中' : '创建生成任务'}
          </button>
        )}
      />

      {error ? (
        <div className="garden-alert garden-alert-danger" style={{ borderRadius: 12, marginBottom: 12 }}>
          <Icon icon="ph:warning-circle-light" className="mt-0.5 size-5 shrink-0" />
          <div><p className="font-semibold">订阅任务失败</p><p className="text-xs">{error}</p></div>
        </div>
      ) : null}
      {streamBroken ? (
        <div className="garden-alert garden-alert-danger" style={{ borderRadius: 12, marginBottom: 12, alignItems: 'center' }}>
          <Icon icon="ph:warning-circle-light" className="size-5 shrink-0" />
          <div className="flex flex-wrap items-center gap-3"><span className="text-xs">进度连接中断；任务仍在服务端执行。</span>
            <button className="mb-pill-btn" style={{ height: 26, fontSize: 11 }} onClick={() => { setStreamBroken(false); setStreamAttempt(v => v + 1); refresh().catch(() => {}) }}>重新连接</button>
          </div>
        </div>
      ) : null}

      {preflight ? (
        <div
          className="mb-[14px] flex items-center gap-2.5"
          style={{ padding: '11px 16px', border: `1px solid ${preflight.ready ? 'rgba(63,143,95,.3)' : 'var(--danger-border)'}`, borderRadius: 12, background: preflight.ready ? 'var(--success-bg)' : 'var(--danger-bg)' }}
        >
          <Icon icon={preflight.ready ? 'ph:check-circle-light' : 'ph:warning-circle-light'} style={{ fontSize: 17, color: preflight.ready ? 'var(--primary)' : 'var(--danger)' }} />
          <p style={{ margin: 0, fontSize: 12.5 }}>
            <strong>{preflight.ready ? '生成前检查通过' : '生成被阻断'}</strong>{' — '}
            {preflight.ready
              ? `预计从 ${preflight.sourcesTotal} 个来源生成约 ${preflight.nodesEstimated} 个节点；管线：采集 → 解析 → 去重 → 编码 → mihomo 转换 → 验证 → 原子发布 → 备份。`
              : preflight.blockingErrors.join('；')}
          </p>
        </div>
      ) : null}

      <section className="grid items-start gap-[14px]" style={{ gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)' }}>
        {/* left */}
        <div className="flex min-w-0 flex-col gap-[14px]">
          {/* 健康检查 */}
          <div className="mb-card" style={{ padding: '14px 18px' }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 14.5, fontWeight: 700 }}>健康检查</h2>
            <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {checks.map(c => (
                <div key={c.label} className="flex items-start gap-2" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--card2)' }}>
                  <Icon icon={c.ok ? 'ph:check-circle-fill' : 'ph:warning-circle-fill'} style={{ fontSize: 14, color: c.ok ? 'var(--success)' : 'var(--warning)', marginTop: 2 }} />
                  <div className="min-w-0"><p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{c.label}</p><p style={{ margin: '1px 0 0', fontSize: 10.5, color: 'var(--muted-foreground)' }}>{c.detail}</p></div>
                </div>
              ))}
            </div>
          </div>

          {/* 任务历史 */}
          <div className="mb-card overflow-hidden">
            <div style={{ padding: '12px 18px 8px' }}>
              <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>任务历史</h2>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--muted-foreground)' }}>刷新与服务重启后可恢复；失败任务支持按原输入重试。</p>
            </div>
            <table className="mb-table">
              <tbody>
                {jobs.map(job => {
                  const tone = jobTone(job)
                  return (
                    <tr key={job.id}>
                      <td style={{ padding: '9px 18px', borderTop: '1px solid var(--border)' }}>
                        <span style={{ fontWeight: 600, fontSize: 12.5 }}>{job.nodesGenerated} 个节点</span><br />
                        <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{new Date(job.createdAt).toLocaleString('zh-CN')} · 来源 {job.sourcesSucceeded}/{job.sourcesTotal}</span>
                      </td>
                      <td style={{ padding: '9px 10px', borderTop: '1px solid var(--border)', fontSize: 11.5, color: 'var(--muted-foreground)' }}>{STEP_LABELS[job.step]} · {job.message}</td>
                      <td style={{ padding: '9px 10px', borderTop: '1px solid var(--border)' }}>
                        <span style={{ display: 'inline-flex', padding: '2px 9px', borderRadius: 99, background: tone === 'muted' ? 'var(--card2)' : `var(--${tone}-bg)`, color: tone === 'muted' ? 'var(--muted-foreground)' : `var(--${tone})`, fontSize: 11, fontWeight: 600 }}>{jobStatusText(job)}</span>
                      </td>
                      <td style={{ padding: '9px 18px', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          {job.status === 'failed' || job.status === 'partial' ? <button className="mb-pill-btn" style={{ height: 26, padding: '0 10px', fontSize: 11, borderRadius: 99 }} onClick={() => retry(job)}>重试</button> : null}
                          <Link to={`/logs?source=subscription&task=${encodeURIComponent(job.id)}`} className="mb-pill-btn" style={{ height: 26, padding: '0 10px', fontSize: 11, borderRadius: 99 }}>日志</Link>
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {jobs.length === 0 ? <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 12 }}>尚无订阅生成记录。</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* right */}
        <div className="flex flex-col gap-[14px]">
          {/* 来源就绪度 */}
          <div className="mb-card" style={{ padding: '14px 18px' }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 14.5, fontWeight: 700 }}>来源就绪度</h2>
            <p style={{ margin: '0 0 10px', fontSize: 11.5, color: 'var(--muted-foreground)' }}>{preflight?.sourcesTotal ?? sourceNodes.length} 个来源 · {sourceNodes.filter(n => n.online).length} 个可读</p>
            <div className="flex flex-col gap-[7px]">
              {sourceNodes.map(node => {
                const tone = node.online ? 'success' : 'warning'
                return (
                  <div key={node.nodeId} className="flex items-center justify-between gap-2" style={{ padding: '8px 11px', borderRadius: 10, background: 'var(--card2)' }}>
                    <div><p style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{node.name}</p><p style={{ margin: 0, fontSize: 10.5, color: 'var(--muted-foreground)' }}>{node.configuredKernels.map(k => k.type).join(' · ') || '未配置监控核心'} · {node.nodesCount ?? 0} 个来源</p></div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 99, background: `var(--${tone}-bg)`, color: `var(--${tone})`, fontSize: 10.5, fontWeight: 600 }}>
                      <span style={{ width: 5, height: 5, borderRadius: 99, background: `var(--${tone})` }} />{node.online ? '可读' : '缓存'}
                    </span>
                  </div>
                )
              })}
              {sourceNodes.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--muted-foreground)' }}>没有来源节点。</p>
                  <Link to="/nodes?intent=add" className="mb-pill-btn primary" style={{ marginTop: 10, height: 30 }}>添加节点</Link>
                </div>
              ) : null}
            </div>
          </div>

          {/* 定时生成策略 */}
          <div className="mb-card" style={{ padding: '14px 18px' }}>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>定时生成策略</h2>
              <button
                onClick={() => setPolicy(p => p ? { ...p, enabled: !p.enabled } : p)}
                style={{ position: 'relative', width: 36, height: 20, border: 'none', borderRadius: 99, cursor: 'pointer', transition: 'background .2s', background: policy?.enabled ? 'var(--primary)' : 'var(--border)', padding: 0 }}
                aria-pressed={Boolean(policy?.enabled)} aria-label="启用定时生成"
              >
                <span style={{ position: 'absolute', top: 2, left: policy?.enabled ? 18 : 2, width: 16, height: 16, borderRadius: 99, background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
              </button>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <PolicyField label="Cron" value={policy?.cron ?? ''} onChange={v => setPolicy(p => p ? { ...p, cron: v } : p)} />
              <PolicyField label="新鲜度目标（小时）" value={String(policy?.freshnessHours ?? '')} onChange={v => setPolicy(p => p ? { ...p, freshnessHours: Number(v) || 0 } : p)} />
              <PolicyField label="节点突降阈值（%）" value={String(policy?.nodeDropPercent ?? '')} onChange={v => setPolicy(p => p ? { ...p, nodeDropPercent: Number(v) || 0 } : p)} />
              <PolicyField label="重试间隔（分钟）" value={(policy?.retryDelaysMinutes ?? []).join(', ')} onChange={v => setPolicy(p => p ? { ...p, retryDelaysMinutes: v.split(',').map(x => Number(x.trim())).filter(Number.isFinite) } : p)} />
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--muted-foreground)' }}>备份保留 {policy?.backupRetention ?? 30} 份</p>
            <button onClick={savePolicy} disabled={!policy || updatePolicy.isPending} className="mb-pill-btn primary" style={{ marginTop: 10, height: 30, fontSize: 11.5 }}>保存策略</button>
          </div>
        </div>
      </section>
    </>
  )
}

function PolicyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: 'var(--muted-foreground)', marginBottom: 4 }}>{label}</label>
      <input
        value={value} onChange={e => onChange(e.target.value)}
        className="signal-mono"
        style={{ width: '100%', height: 30, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--card)', color: 'var(--foreground)', fontSize: 11.5, outline: 'none', boxSizing: 'border-box' }}
      />
    </div>
  )
}
