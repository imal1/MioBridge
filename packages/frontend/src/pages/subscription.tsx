import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { apiService } from '@/lib/api'
import { streamServerEvents } from '@/lib/sse'
import type { ClusterStatus, SubscriptionJob, SubscriptionPreflight } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import SignalPage from '@/components/shared/SignalPage'

const STEP_LABELS: Record<SubscriptionJob['step'], string> = {
  collect: '采集', parse: '解析', deduplicate: '去重', encode: '编码', convert: 'mihomo 转换',
  validate: '验证', publish: '原子发布', backup: '备份', done: '完成',
}

function message(value: unknown, fallback: string) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') return value.message
  return fallback
}

function jobBadge(job: SubscriptionJob) {
  if (job.status === 'succeeded') return <Badge variant="secondary">成功</Badge>
  if (job.status === 'partial') return <Badge>部分成功</Badge>
  if (job.status === 'failed') return <Badge variant="destructive">失败</Badge>
  return <Badge>{job.status === 'queued' ? '排队中' : '生成中'}</Badge>
}

export default function SubscriptionPage() {
  const [cluster, setCluster] = useState<ClusterStatus | null>(null)
  const [preflight, setPreflight] = useState<SubscriptionPreflight | null>(null)
  const [jobs, setJobs] = useState<SubscriptionJob[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 进度流断开必须显式暴露：静默关闭连接会让页面停在过期进度上，用户以为任务卡住了。
  const [streamBroken, setStreamBroken] = useState(false)
  const [streamAttempt, setStreamAttempt] = useState(0)

  const refresh = useCallback(async () => {
    const [clusterResponse, preflightResponse, jobResponse] = await Promise.all([
      apiService.getClusterStatus(), apiService.preflightSubscription(), apiService.getSubscriptionJobs(),
    ])
    if (clusterResponse.success) setCluster(clusterResponse.data as ClusterStatus)
    if (preflightResponse.success && preflightResponse.data) setPreflight(preflightResponse.data)
    if (jobResponse.success && jobResponse.data) setJobs(jobResponse.data.jobs)
  }, [])

  useEffect(() => {
    refresh().catch(caught => setError(caught instanceof Error ? caught.message : '订阅任务加载失败'))
    const timer = window.setInterval(() => refresh().catch(() => {}), 5000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const activeJobs = useMemo(() => jobs.filter(job => job.status === 'queued' || job.status === 'running'), [jobs])
  useEffect(() => {
    if (!activeJobs.length) return setStreamBroken(false)
    const controllers = activeJobs.map(job => {
      const controller = new AbortController()
      streamServerEvents(`/api/subscription-jobs/${encodeURIComponent(job.id)}/events`, {
        signal: controller.signal,
        onMessage: () => { setStreamBroken(false); refresh().catch(() => {}) },
      }).catch(() => {
        // 卸载时主动 abort 不是故障，只有真正的连接失败才提示重连。
        if (!controller.signal.aborted) setStreamBroken(true)
      })
      return controller
    })
    return () => controllers.forEach(controller => controller.abort())
  }, [activeJobs.map(job => job.id).join(','), refresh, streamAttempt])

  const sourceNodes = useMemo(() => cluster?.nodes || [], [cluster?.nodes])

  const generate = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const check = await apiService.preflightSubscription()
      if (!check.success || !check.data?.ready) throw new Error(check.data?.blockingErrors.join('；') || message(check.error, '没有可读来源'))
      const response = await apiService.startSubscriptionJob()
      if (!response.success) throw new Error(message(response.error, '创建订阅任务失败'))
      toast.success('订阅任务已持久化并进入队列', { description: response.data?.jobId })
      await refresh()
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : '创建订阅任务失败'
      setError(detail); toast.error('订阅生成未启动', { description: detail })
    } finally { setLoading(false) }
  }, [refresh])

  const retry = useCallback(async (job: SubscriptionJob) => {
    // apiService 在 HTTP 失败时抛出 ApiError，不捕获的话异常会逃逸且用户看不到任何反馈。
    try {
      const response = await apiService.retrySubscriptionJob(job.id)
      if (!response.success) throw new Error(message(response.error, '无法按原输入重试'))
      toast.success('已按上次输入创建重试任务')
      await refresh()
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : '无法按原输入重试'
      setError(detail)
      toast.error('任务重试失败', { description: detail })
    }
  }, [refresh])

  return (
    <SignalPage crumb="Subscription jobs" title="订阅生成" description="先预检来源，再以持久化任务执行采集、解析、去重、转换、验证、发布和备份。" status={`${preflight?.sourcesTotal || 0} 个来源 · ${activeJobs.length} 个活动任务`} maxWidth="narrow" actions={<Button variant="outline" onClick={refresh}><Icon icon="ph:arrow-clockwise-light" />重新预检</Button>}>
      {error ? <Alert variant="destructive"><AlertTitle>订阅任务失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {streamBroken ? <Alert variant="destructive"><AlertTitle>订阅进度连接已中断</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3"><span>页面显示的进度可能已经过期；任务本身仍在服务端继续执行。</span><Button size="sm" variant="outline" onClick={() => { setStreamBroken(false); setStreamAttempt(value => value + 1); refresh().catch(() => {}) }}>重新连接进度</Button></AlertDescription></Alert> : null}
      {preflight ? <Alert variant={preflight.ready ? 'success' : 'destructive'}><AlertTitle>{preflight.ready ? '生成前检查通过' : '生成被阻断'}</AlertTitle><AlertDescription>{preflight.ready ? `预计从 ${preflight.sourcesTotal} 个来源生成约 ${preflight.nodesEstimated} 个节点。${preflight.warnings.length ? ` ${preflight.warnings.join('；')}` : ''}` : preflight.blockingErrors.join('；')}</AlertDescription></Alert> : null}

      <div className="grid gap-5 md:grid-cols-3">
        <Card variant="elevated"><CardHeader><CardDescription>配置来源</CardDescription><CardTitle className="signal-value">{preflight?.sourcesTotal || 0}</CardTitle></CardHeader></Card>
        <Card variant="elevated"><CardHeader><CardDescription>预计有效节点</CardDescription><CardTitle className="signal-value signal-success">{preflight?.nodesEstimated || 0}</CardTitle></CardHeader></Card>
        <Card variant="elevated"><CardHeader><CardDescription>预检警告/阻断</CardDescription><CardTitle className="signal-value signal-danger">{(preflight?.warnings.length || 0) + (preflight?.blockingErrors.length || 0)}</CardTitle></CardHeader></Card>
      </div>

      <Card className="mt-5"><CardHeader><CardTitle>来源就绪度</CardTitle><CardDescription>此处只展示和跳转；Agent 与运行时的维护仍由其唯一页面负责。</CardDescription></CardHeader><CardContent className="space-y-3">{sourceNodes.map(node => <div key={node.nodeId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--surface-container)] p-4"><div><p className="font-medium">{node.name}</p><p className="text-xs text-muted-foreground">{node.configuredKernels.map(item => item.type).join(' · ') || '未配置监控核心'} · {node.nodesCount ?? 0} 个来源</p></div><div className="flex items-center gap-2"><Badge variant={node.online ? 'secondary' : 'destructive'}>{node.online ? 'Agent 可达' : 'Agent 异常'}</Badge>{!node.online ? <Button asChild size="sm" variant="outline"><Link to={`/agents?node=${encodeURIComponent(node.nodeId)}`}>维护 Agent</Link></Button> : !node.configuredKernels.length ? <Button asChild size="sm" variant="outline"><Link to={`/runtimes?node=${encodeURIComponent(node.nodeId)}`}>配置运行时</Link></Button> : null}</div></div>)}{sourceNodes.length === 0 ? <div className="rounded-2xl bg-[var(--surface-container)] p-8 text-center"><p className="text-muted-foreground">没有来源节点，暂时无法生成订阅。</p><Button asChild className="mt-4"><Link to="/nodes?intent=add">添加节点</Link></Button></div> : null}</CardContent></Card>

      <Card className="mt-5"><CardHeader><CardTitle>执行正式生成</CardTitle><CardDescription>零可读来源会阻断；部分节点离线时任务可以 partial 完成，并保留警告。</CardDescription></CardHeader><CardContent className="space-y-4"><Alert><AlertTitle>正式管线</AlertTitle><AlertDescription>采集 → 解析 → 去重 → Base64 编码 → mihomo 转换 → 验证 → 原子发布 → 备份。</AlertDescription></Alert><Button onClick={generate} disabled={loading || !preflight?.ready || activeJobs.length > 0}><Icon icon={loading ? 'ph:spinner-bold' : 'ph:play-circle-light'} className={loading ? 'animate-spin' : ''} />{loading ? '创建任务中' : activeJobs.length ? '已有生成任务执行中' : '创建正式生成任务'}</Button></CardContent></Card>

      <Card className="mt-5"><CardHeader><CardTitle>任务历史</CardTitle><CardDescription>刷新和 Dashboard 重启后仍可恢复；失败任务支持按原始输入重试。</CardDescription></CardHeader><CardContent className="space-y-3">{jobs.map(job => <article key={job.id} className="rounded-2xl bg-[var(--surface-container)] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{STEP_LABELS[job.step]} · {job.nodesGenerated} 个节点</p><p className="mt-1 text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString('zh-CN')} · 来源 {job.sourcesSucceeded}/{job.sourcesTotal}</p></div>{jobBadge(job)}</div><Progress className="mt-4" value={job.progress} /><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className={job.status === 'failed' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{job.message}</p><div className="flex gap-2">{job.status === 'failed' || job.status === 'partial' ? <Button size="sm" variant="outline" onClick={() => retry(job)}>按原输入重试</Button> : null}<Button asChild size="sm" variant="outline"><Link to={`/logs?source=subscription&task=${encodeURIComponent(job.id)}`}>任务日志</Link></Button></div></div>{job.warnings.length ? <p className="mt-2 text-xs text-muted-foreground">警告：{job.warnings.join('；')}</p> : null}</article>)}{jobs.length === 0 ? <p className="rounded-2xl bg-[var(--surface-container)] p-8 text-center text-muted-foreground">尚无订阅生成记录。</p> : null}</CardContent></Card>

      {jobs.some(job => job.status === 'succeeded' || job.status === 'partial') ? <div className="mt-5 flex flex-wrap gap-2"><Button asChild><Link to="/outputs">前往衍生输出</Link></Button><Button asChild variant="outline"><Link to="/subscription-status">维护订阅状态</Link></Button></div> : null}
    </SignalPage>
  )
}
