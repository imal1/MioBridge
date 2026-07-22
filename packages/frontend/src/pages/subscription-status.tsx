import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '@iconify/react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  queryKeys, useArtifacts, useStatus, useSubscriptionJobs, useSubscriptionPolicy, useUpdateSubscriptionPolicy,
} from '@/lib/queries'
import type { SubscriptionJob, SubscriptionPolicy } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import SignalPage from '@/components/shared/SignalPage'

const DEFAULT_POLICY: SubscriptionPolicy = { enabled: false, cron: '0 */6 * * *', freshnessHours: 24, nodeDropPercent: 30, retryDelaysMinutes: [1, 5, 15], backupRetention: 30 }

/** 对外兼容 URL：状态检查必须真的取一次，不能只看产物元数据。 */
const PUBLIC_URLS = ['/raw.txt', '/subscription.txt', '/clash.yaml'] as const

// 重试间隔以整数分钟计（标签与 OpenAPI schema 都声明 integer），
// 小数既无实际意义也会让界面与契约不一致，这里直接滤掉。
function parseMinutes(value: string): number[] {
  return value.split(',').map(item => Number(item.trim())).filter(item => Number.isInteger(item) && item > 0)
}

/**
 * 用最近两次产出节点的正式任务比较节点数量跌幅。
 * 只有一条历史时无从比较，此时不谎报异常，也不谎报通过——按「无法判定」处理为通过。
 */
function nodeDropCheck(jobs: SubscriptionJob[], threshold: number): { ok: boolean; detail: string } {
  const history = jobs
    .filter(job => ['succeeded', 'partial'].includes(job.status))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const [current, previous] = history
  if (!current || !previous || previous.nodesGenerated <= 0) {
    return { ok: true, detail: `历史不足，无法比较；下降 ${threshold}% 时预警` }
  }
  const dropPercent = ((previous.nodesGenerated - current.nodesGenerated) / previous.nodesGenerated) * 100
  if (dropPercent < threshold) {
    return { ok: true, detail: `较上次 ${previous.nodesGenerated} 个节点变化 ${dropPercent.toFixed(1)}%，低于 ${threshold}% 阈值` }
  }
  return { ok: false, detail: `节点数由 ${previous.nodesGenerated} 降至 ${current.nodesGenerated}（下降 ${dropPercent.toFixed(1)}%），已超过 ${threshold}% 阈值` }
}

export default function SubscriptionStatusPage() {
  const queryClient = useQueryClient()
  const statusQuery = useStatus()
  const artifactsQuery = useArtifacts()
  const jobsQuery = useSubscriptionJobs()
  const policyQuery = useSubscriptionPolicy()
  const updatePolicy = useUpdateSubscriptionPolicy()
  const status = statusQuery.data ?? null
  const artifacts = useMemo(() => artifactsQuery.data ?? [], [artifactsQuery.data])
  const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data])
  const [policy, setPolicy] = useState<SubscriptionPolicy>(DEFAULT_POLICY)
  const [draft, setDraft] = useState<SubscriptionPolicy>(DEFAULT_POLICY)
  // 重试间隔是自由文本，必须独立保存，否则用户敲到 "2," 时会被立刻改写。
  const [retryText, setRetryText] = useState(DEFAULT_POLICY.retryDelaysMinutes.join(', '))
  const [publicUrls, setPublicUrls] = useState<Array<{ path: string; ok: boolean }>>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 草稿是否已被用户编辑，只能相对「草稿派生自的那份生效值」判断，
  // 所以这里同步保留一份 policy 的即时副本，供异步回调读取。
  const policyRef = useRef(DEFAULT_POLICY)
  const applyPolicy = useCallback((next: SubscriptionPolicy) => {
    policyRef.current = next
    setPolicy(next)
  }, [])
  // 草稿同样需要一份即时副本：异步刷新要判断「用户是否已经改过」才能决定是否跟随。
  const draftRef = useRef(DEFAULT_POLICY)
  const resetDraft = useCallback((next: SubscriptionPolicy) => {
    draftRef.current = next
    setDraft(next)
    setRetryText(next.retryDelaysMinutes.join(', '))
  }, [])
  const updateDraft = useCallback((patch: Partial<SubscriptionPolicy>) => {
    setDraft(previous => {
      const next = { ...previous, ...patch }
      draftRef.current = next
      return next
    })
  }, [])

  // 真实拉取每个公共 URL：产物元数据说“存在”不等于对外真的能取到。apiService 不覆盖
  // 这些同源静态路径，保留独立 fetch 探测。
  const probePublicUrls = useCallback(async () => {
    const probes = await Promise.all(PUBLIC_URLS.map(async path => {
      try {
        const response = await fetch(path, { cache: 'no-store' })
        return { path, ok: response.ok }
      } catch { return { path, ok: false } }
    }))
    setPublicUrls(probes)
  }, [])
  useEffect(() => { void probePublicUrls() }, [probePublicUrls])

  // 生效策略随查询更新；只有草稿仍等于旧生效值（用户没有未保存的编辑）时才跟随刷新，
  // 否则迟到的响应会静默吞掉用户已经输入的内容。要放弃编辑请用「放弃草稿」。
  useEffect(() => {
    if (!policyQuery.data) return
    const next = policyQuery.data
    const baseline = policyRef.current
    applyPolicy(next)
    if (JSON.stringify(draftRef.current) === JSON.stringify(baseline)) resetDraft(next)
  }, [policyQuery.data, applyPolicy, resetDraft])

  const refresh = useCallback(() => {
    setError(null)
    void queryClient.invalidateQueries({ queryKey: queryKeys.status })
    void queryClient.invalidateQueries({ queryKey: queryKeys.artifacts })
    void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionJobs })
    void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionPolicy })
    void probePublicUrls()
  }, [probePublicUrls, queryClient])

  const loadError = (statusQuery.error ?? artifactsQuery.error ?? jobsQuery.error ?? policyQuery.error)?.message ?? null

  const latestJob = jobs[0]
  const checks = useMemo(() => [
    ...artifacts.map(item => ({ label: item.name, ok: item.exists && item.valid, detail: item.exists ? `${item.size} bytes · ${item.freshness === 'fresh' ? '新鲜' : item.freshness === 'expiring' ? '即将过期' : item.freshness === 'stale' ? '已过期' : item.validationError || '无效'}` : '文件缺失' })),
    { label: 'mihomo 转换器', ok: Boolean(status?.mihomoAvailable), detail: status?.mihomoVersion || '不可用' },
    {
      label: '公共兼容 URL',
      ok: publicUrls.length === PUBLIC_URLS.length && publicUrls.every(item => item.ok),
      detail: publicUrls.length
        ? publicUrls.map(item => `${item.path} ${item.ok ? '可用' : '不可用'}`).join(' · ')
        : '正在检查 /raw.txt · /subscription.txt · /clash.yaml',
    },
    { label: '上次正式任务', ok: Boolean(latestJob && ['succeeded', 'partial'].includes(latestJob.status)), detail: latestJob ? `${latestJob.status} · ${latestJob.nodesGenerated} 个节点 · ${new Date(latestJob.createdAt).toLocaleString('zh-CN')}` : '尚无任务记录' },
    { label: '节点突降阈值', ...nodeDropCheck(jobs, draft.nodeDropPercent) },
  ], [artifacts, draft.nodeDropPercent, jobs, latestJob, publicUrls, status?.mihomoAvailable, status?.mihomoVersion])
  const healthy = checks.every(item => item.ok)
  const dirty = JSON.stringify(policy) !== JSON.stringify(draft)

  const savePolicy = async () => {
    setSaving(true); setError(null)
    try {
      const response = await updatePolicy.mutateAsync(draft)
      if (!response.success || !response.data) throw new Error('定时策略保存失败')
      applyPolicy(response.data); resetDraft(response.data); toast.success('订阅策略已保存')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '定时策略保存失败') }
    finally { setSaving(false) }
  }

  return (
    <SignalPage crumb="Subscription health" title="订阅状态" description="维护正式产物的新鲜度、格式、公共 URL、上次任务与定时生成策略。" status={healthy ? '订阅健康' : `${checks.filter(item => !item.ok).length} 个问题待处理`} maxWidth="narrow" actions={<Button variant="outline" onClick={refresh}><Icon icon="ph:heartbeat-light" />立即检查</Button>}>
      {(error ?? loadError) ? <Alert variant="destructive"><AlertTitle>状态检查失败</AlertTitle><AlertDescription>{error ?? loadError}</AlertDescription></Alert> : null}
      {!healthy ? <Alert variant="destructive"><AlertTitle>订阅闭环未完成</AlertTitle><AlertDescription>本页只诊断和维护策略；需要生成、运行时维护或产物操作时跳转到唯一负责页面。</AlertDescription></Alert> : <Alert variant="success"><AlertTitle>所有检查通过</AlertTitle><AlertDescription>正式订阅及兼容 URL 当前可用。</AlertDescription></Alert>}
      <div className="mt-5 grid gap-4 md:grid-cols-2">{checks.map(item => <Card key={item.label}><CardContent className="flex items-center justify-between gap-4 p-5"><div><p className="font-medium">{item.label}</p><p className="mt-1 text-sm text-muted-foreground">{item.detail}</p></div><Badge variant={item.ok ? 'secondary' : 'destructive'}>{item.ok ? '通过' : '异常'}</Badge></CardContent></Card>)}</div>

      <Card className="mt-5"><CardHeader><CardTitle>定时生成与状态阈值</CardTitle><CardDescription>默认关闭；开启后默认每 6 小时执行，新鲜度达到目标的 80% 时进入预警区间。</CardDescription></CardHeader><CardContent className="space-y-5"><label className="flex items-center gap-3 rounded-2xl bg-[var(--surface-container)] p-4"><input type="checkbox" checked={draft.enabled} onChange={event => updateDraft({ enabled: event.target.checked })} /><span><span className="block font-medium">启用定时生成</span><span className="block text-xs text-muted-foreground">关闭时仍可在订阅生成页手动创建任务</span></span></label><div className="grid gap-4 md:grid-cols-3"><div className="grid gap-2"><Label htmlFor="policy-cron">Cron</Label><Input id="policy-cron" value={draft.cron} onChange={event => updateDraft({ cron: event.target.value })} /></div><div className="grid gap-2"><Label htmlFor="freshness-hours">新鲜度目标（小时）</Label><Input id="freshness-hours" type="number" min={1} value={draft.freshnessHours} onChange={event => updateDraft({ freshnessHours: Number(event.target.value) })} /></div><div className="grid gap-2"><Label htmlFor="node-drop">节点突降阈值（%）</Label><Input id="node-drop" type="number" min={0} max={100} value={draft.nodeDropPercent} onChange={event => updateDraft({ nodeDropPercent: Number(event.target.value) })} /></div></div><div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="retry-delays">失败重试间隔（分钟，逗号分隔）</Label>
          <Input id="retry-delays" value={retryText} onChange={event => { setRetryText(event.target.value); updateDraft({ retryDelaysMinutes: parseMinutes(event.target.value) }) }} placeholder="1, 5, 15" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="backup-retention">备份保留数量（份）</Label>
          <Input id="backup-retention" type="number" min={1} value={draft.backupRetention} onChange={event => updateDraft({ backupRetention: Number(event.target.value) })} />
        </div>
      </div><p className="text-sm text-muted-foreground">当前重试计划：{draft.retryDelaysMinutes.join(' / ') || '无'} 分钟 · 预警阈值：{Math.round(draft.freshnessHours * 0.8)} 小时</p><div className="flex gap-2"><Button onClick={savePolicy} disabled={!dirty || saving}><Icon icon={saving ? 'ph:spinner-bold' : 'ph:floppy-disk-light'} className={saving ? 'animate-spin' : ''} />保存策略</Button><Button variant="outline" disabled={!dirty} onClick={() => resetDraft(policy)}>放弃草稿</Button></div></CardContent></Card>

      <Card className="mt-5"><CardHeader><CardTitle>恢复路径</CardTitle><CardDescription>各动作只在其所属页面执行，避免重复功能。</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2"><Button asChild><Link to="/subscription">生成或重试订阅</Link></Button><Button asChild variant="outline"><Link to="/runtimes">维护来源与转换器</Link></Button><Button asChild variant="outline"><Link to="/outputs">预览与验证产物</Link></Button><Button asChild variant="outline"><Link to="/logs">查看任务日志</Link></Button></CardContent></Card>
    </SignalPage>
  )
}
