import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { apiService, type ApiStatus } from '@/lib/api'
import type { ArtifactState, SubscriptionJob, SubscriptionPolicy } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import SignalPage from '@/components/shared/SignalPage'
import WorkflowRail from '@/components/shared/WorkflowRail'

const DEFAULT_POLICY: SubscriptionPolicy = { enabled: false, cron: '0 */6 * * *', freshnessHours: 24, nodeDropPercent: 30, retryDelaysMinutes: [1, 5, 15], backupRetention: 30 }

export default function SubscriptionStatusPage() {
  const [status, setStatus] = useState<ApiStatus | null>(null)
  const [artifacts, setArtifacts] = useState<ArtifactState[]>([])
  const [jobs, setJobs] = useState<SubscriptionJob[]>([])
  const [policy, setPolicy] = useState<SubscriptionPolicy>(DEFAULT_POLICY)
  const [draft, setDraft] = useState<SubscriptionPolicy>(DEFAULT_POLICY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 草稿是否已被用户编辑，只能相对「草稿派生自的那份生效值」判断，
  // 所以这里同步保留一份 policy 的即时副本，供异步回调读取。
  const policyRef = useRef(DEFAULT_POLICY)
  const applyPolicy = useCallback((next: SubscriptionPolicy) => {
    policyRef.current = next
    setPolicy(next)
  }, [])

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [nextStatus, artifactResponse, jobResponse, policyResponse] = await Promise.all([
        apiService.getStatus(), apiService.getArtifacts(), apiService.getSubscriptionJobs(), apiService.getSubscriptionPolicy(),
      ])
      setStatus(nextStatus)
      if (artifactResponse.success && artifactResponse.data) setArtifacts(artifactResponse.data.artifacts)
      if (jobResponse.success && jobResponse.data) setJobs(jobResponse.data.jobs)
      if (policyResponse.success && policyResponse.data) {
        const next = policyResponse.data
        const baseline = policyRef.current
        applyPolicy(next)
        // 只有草稿仍与旧生效值一致（用户没有未保存的编辑）时才跟随刷新；
        // 否则迟到的响应会静默吞掉用户已经输入的内容。要放弃编辑请用「放弃草稿」。
        setDraft(previous => JSON.stringify(previous) === JSON.stringify(baseline) ? next : previous)
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : '状态检查失败') }
  }, [applyPolicy])
  useEffect(() => { refresh().catch(() => {}) }, [refresh])

  const latestJob = jobs[0]
  const checks = useMemo(() => [
    ...artifacts.map(item => ({ label: item.name, ok: item.exists && item.valid, detail: item.exists ? `${item.size} bytes · ${item.freshness === 'fresh' ? '新鲜' : item.freshness === 'expiring' ? '即将过期' : item.freshness === 'stale' ? '已过期' : item.validationError || '无效'}` : '文件缺失' })),
    { label: 'mihomo 转换器', ok: Boolean(status?.mihomoAvailable), detail: status?.mihomoVersion || '不可用' },
    { label: '公共兼容 URL', ok: artifacts.every(item => item.exists), detail: '/raw.txt · /subscription.txt · /clash.yaml' },
    { label: '上次正式任务', ok: Boolean(latestJob && ['succeeded', 'partial'].includes(latestJob.status)), detail: latestJob ? `${latestJob.status} · ${latestJob.nodesGenerated} 个节点 · ${new Date(latestJob.createdAt).toLocaleString('zh-CN')}` : '尚无任务记录' },
    { label: '节点突降阈值', ok: true, detail: `相较上次成功输入下降 ${draft.nodeDropPercent}% 时预警` },
  ], [artifacts, draft.nodeDropPercent, latestJob, status?.mihomoAvailable, status?.mihomoVersion])
  const healthy = checks.every(item => item.ok)
  const dirty = JSON.stringify(policy) !== JSON.stringify(draft)

  const savePolicy = async () => {
    setSaving(true); setError(null)
    try {
      const response = await apiService.updateSubscriptionPolicy(draft)
      if (!response.success || !response.data) throw new Error('定时策略保存失败')
      applyPolicy(response.data); setDraft(response.data); toast.success('订阅策略已保存')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '定时策略保存失败') }
    finally { setSaving(false) }
  }

  return (
    <SignalPage crumb="Subscription health" title="订阅状态" description="维护正式产物的新鲜度、格式、公共 URL、上次任务与定时生成策略。" status={healthy ? '订阅健康' : `${checks.filter(item => !item.ok).length} 个问题待处理`} maxWidth="narrow" actions={<Button variant="outline" onClick={refresh}><Icon icon="ph:heartbeat-light" />立即检查</Button>}>
      <WorkflowRail current="maintain-subscription" />
      {error ? <Alert variant="destructive"><AlertTitle>状态检查失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {!healthy ? <Alert variant="destructive"><AlertTitle>订阅闭环未完成</AlertTitle><AlertDescription>本页只诊断和维护策略；需要生成、运行时维护或产物操作时跳转到唯一负责页面。</AlertDescription></Alert> : <Alert variant="success"><AlertTitle>所有检查通过</AlertTitle><AlertDescription>正式订阅及兼容 URL 当前可用。</AlertDescription></Alert>}
      <div className="mt-5 grid gap-4 md:grid-cols-2">{checks.map(item => <Card key={item.label}><CardContent className="flex items-center justify-between gap-4 p-5"><div><p className="font-medium">{item.label}</p><p className="mt-1 text-sm text-muted-foreground">{item.detail}</p></div><Badge variant={item.ok ? 'secondary' : 'destructive'}>{item.ok ? '通过' : '异常'}</Badge></CardContent></Card>)}</div>

      <Card className="mt-5"><CardHeader><CardTitle>定时生成与状态阈值</CardTitle><CardDescription>默认关闭；开启后默认每 6 小时执行，新鲜度达到目标的 80% 时进入预警区间。</CardDescription></CardHeader><CardContent className="space-y-5"><label className="flex items-center gap-3 rounded-2xl bg-[var(--surface-container)] p-4"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft(previous => ({ ...previous, enabled: event.target.checked }))} /><span><span className="block font-medium">启用定时生成</span><span className="block text-xs text-muted-foreground">关闭时仍可在订阅生成页手动创建任务</span></span></label><div className="grid gap-4 md:grid-cols-3"><div className="grid gap-2"><Label htmlFor="policy-cron">Cron</Label><Input id="policy-cron" value={draft.cron} onChange={event => setDraft(previous => ({ ...previous, cron: event.target.value }))} /></div><div className="grid gap-2"><Label htmlFor="freshness-hours">新鲜度目标（小时）</Label><Input id="freshness-hours" type="number" min={1} value={draft.freshnessHours} onChange={event => setDraft(previous => ({ ...previous, freshnessHours: Number(event.target.value) }))} /></div><div className="grid gap-2"><Label htmlFor="node-drop">节点突降阈值（%）</Label><Input id="node-drop" type="number" min={0} max={100} value={draft.nodeDropPercent} onChange={event => setDraft(previous => ({ ...previous, nodeDropPercent: Number(event.target.value) }))} /></div></div><div className="rounded-2xl bg-[var(--surface-container)] p-4 text-sm"><p>失败重试：{draft.retryDelaysMinutes.join(' / ')} 分钟</p><p className="mt-1 text-muted-foreground">备份保留：最近 {draft.backupRetention} 份 · 预警阈值：{Math.round(draft.freshnessHours * 0.8)} 小时</p></div><div className="flex gap-2"><Button onClick={savePolicy} disabled={!dirty || saving}><Icon icon={saving ? 'ph:spinner-bold' : 'ph:floppy-disk-light'} className={saving ? 'animate-spin' : ''} />保存策略</Button><Button variant="outline" disabled={!dirty} onClick={() => setDraft(policy)}>放弃草稿</Button></div></CardContent></Card>

      <Card className="mt-5"><CardHeader><CardTitle>恢复路径</CardTitle><CardDescription>各动作只在其所属页面执行，避免重复功能。</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2"><Button asChild><Link to="/subscription">生成或重试订阅</Link></Button><Button asChild variant="outline"><Link to="/runtimes">维护来源与转换器</Link></Button><Button asChild variant="outline"><Link to="/outputs">预览与验证产物</Link></Button><Button asChild variant="outline"><Link to="/logs">查看任务日志</Link></Button></CardContent></Card>
    </SignalPage>
  )
}
