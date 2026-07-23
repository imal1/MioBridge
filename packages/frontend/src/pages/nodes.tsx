import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '@iconify/react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { apiService } from '@/lib/api'
import { streamServerEvents } from '@/lib/sse'
import {
  KERNEL_TYPES, type ComponentDeployStatus, type DeployComponent, type DeployOperation,
  type KernelDetection, type KernelType, type NodeKernelConfig, type NodeStatus, type SshAuthMethod,
} from '@/lib/types'
import {
  queryKeys, useAgentAction, useClusterHealthCheck, useClusterStatus, useComponentDeployments,
  useCancelDeployment, useDeleteNode, useRetryDeployment, useStartDeployment, useUpdateNode, useUpdateNodeKernels,
} from '@/lib/queries'
import { AddNodeForm } from '@/components/cluster/AddNodeForm'
import { KernelDetectionDialog } from '@/components/cluster/KernelDetectionDialog'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Filter = 'all' | 'enabled' | 'disabled' | 'undeployed'
type DetailTab = 'overview' | 'deploy' | 'agent' | 'runtime'

const KERNEL_LABEL: Record<KernelType, string> = { 'sing-box': 'sing-box', xray: 'Xray', v2ray: 'V2Ray' }
const COMPONENT_LABEL: Record<DeployComponent, string> = { agent: 'Agent', mihomo: 'mihomo', 'sing-box': 'sing-box', xray: 'Xray', v2ray: 'V2Ray' }
const DEPLOY_COMPONENTS: DeployComponent[] = ['agent', 'mihomo', 'sing-box', 'xray', 'v2ray']
const OPERATIONS: Array<{ value: DeployOperation; label: string }> = [
  { value: 'install', label: '安装 — 下载、校验、安装、配置并健康检查' },
  { value: 'reinstall', label: '重新安装 — 覆盖程序并重新校验现有配置' },
  { value: 'upgrade', label: '升级 — 使用当前默认安装来源升级' },
  { value: 'repair', label: '修复 — 修复二进制、权限、服务与健康状态' },
  { value: 'uninstall', label: '卸载 — 停止服务并按策略保留数据' },
]
const STEP_LABELS: Record<string, string> = {
  queued: '排队', prechecking: '预检', downloading: '下载', verifying_package: '校验包', installing: '安装',
  configuring: '配置', restarting: '重启', postchecking: '健康检查', done: '完成',
}
const DETAIL_TABS: Array<{ key: DetailTab; label: string }> = [
  { key: 'overview', label: '概览' }, { key: 'deploy', label: '部署' }, { key: 'agent', label: 'Agent' }, { key: 'runtime', label: '运行时' },
]

function errorMessage(value: unknown, fallback: string) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') return value.message
  return fallback
}

function installed(node: NodeStatus, component: DeployComponent) {
  if (component === 'agent') return Boolean(node.agent?.deployed)
  if (component === 'mihomo') return Boolean(node.mihomoAvailable)
  return Boolean(node.kernels.find(k => k.type === component)?.detected)
}

function agentTone(node: NodeStatus): 'success' | 'danger' | 'muted' {
  if (node.online) return 'success'
  if (node.agent?.deployed) return 'danger'
  return 'muted'
}
function agentLabel(node: NodeStatus) {
  if (node.online) return '在线'
  if (node.agent?.deployed) return '心跳中断'
  return '未安装'
}

interface DeploymentEvent { eventId: string; taskId: string; step: string; status: string; message: string; progress: number; timestamp: string }
const TIMELINE_KEY = 'miobridge:deployment-events'
function readTimeline(): Record<string, DeploymentEvent[]> {
  try { const raw = window.sessionStorage.getItem(TIMELINE_KEY); const p = raw ? JSON.parse(raw) : null; return p && typeof p === 'object' ? p : {} } catch { return {} }
}

// Compact chip / pill helpers -------------------------------------------------
function Chip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 28, padding: '0 12px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600,
        border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
        background: active ? 'var(--success-bg)' : 'transparent',
        color: active ? 'var(--primary)' : 'var(--foreground)',
      }}
    >{children}</button>
  )
}
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--card2)' }}>
      <p style={{ margin: 0, fontSize: 10.5, color: 'var(--muted-foreground)' }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: 12.5, fontWeight: 600 }}>{children}</p>
    </div>
  )
}
const smallBtn = 'mb-pill-btn' // height override via style
const smallBtnStyle: React.CSSProperties = { height: 28, padding: '0 12px', fontSize: 11.5, borderRadius: 99 }

export default function NodesPage() {
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const pollOptions = { refetchInterval: 4000, refetchIntervalInBackground: false } as const
  const clusterQuery = useClusterStatus(pollOptions)
  const deploymentsQuery = useComponentDeployments(undefined, pollOptions)
  const cluster = clusterQuery.data ?? null
  const tasks = deploymentsQuery.data ?? {}

  const updateNode = useUpdateNode()
  const deleteNode = useDeleteNode()
  const agentAction = useAgentAction()
  const healthCheck = useClusterHealthCheck()
  const updateNodeKernels = useUpdateNodeKernels()
  const startDeployment = useStartDeployment()
  const retryDeployment = useRetryDeployment()
  const cancelDeployment = useCancelDeployment()

  const allNodes = useMemo(() => cluster?.nodes || [], [cluster?.nodes])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selId, setSelId] = useState<string | null>(params.get('node'))
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [addOpen, setAddOpen] = useState(params.get('intent') === 'add')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const nodes = useMemo(() => allNodes.filter(node => {
    if (filter === 'enabled' && node.enabled === false) return false
    if (filter === 'disabled' && node.enabled !== false) return false
    if (filter === 'undeployed' && node.agent?.deployed) return false
    const needle = query.trim().toLowerCase()
    return !needle || [node.name, node.host, node.location, node.nodeId].some(v => v?.toLowerCase().includes(needle))
  }), [allNodes, filter, query])

  const sel = selId ? allNodes.find(n => n.nodeId === selId) ?? null : null
  const hasSel = Boolean(sel)

  // ---- edit profile dialog ----
  const [editing, setEditing] = useState<NodeStatus | null>(null)
  const [draft, setDraft] = useState({ name: '', host: '', location: '', sshUser: 'root', sshPort: '22', sshAuthMethod: 'password' as SshAuthMethod, sshCredential: '' })
  const openEdit = (node: NodeStatus) => {
    setEditing(node)
    setDraft({ name: node.name, host: node.host || '', location: node.location, sshUser: node.sshUser || 'root', sshPort: String(node.sshPort ?? 22), sshAuthMethod: node.sshAuthMethod ?? 'password', sshCredential: '' })
  }
  const saveEdit = async () => {
    if (!editing) return
    setBusy(editing.nodeId); setError(null)
    try {
      const { sshPort, sshAuthMethod, sshCredential, ...rest } = draft
      const isLocal = editing.nodeId === 'local'
      const response = await updateNode.mutateAsync({
        nodeId: editing.nodeId,
        patch: {
          ...rest,
          ...(!isLocal ? { sshPort: Number(sshPort) || 22 } : {}),
          ...(sshCredential ? sshAuthMethod === 'password' ? { sshAuthMethod, sshPassword: sshCredential } : { sshAuthMethod, sshPrivateKey: sshCredential } : {}),
        },
      })
      if (!response.success) throw new Error(response.error || '节点更新失败')
      setEditing(null); toast.success('节点档案已更新')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '节点更新失败') }
    finally { setBusy(null) }
  }

  const toggleEnabled = async (node: NodeStatus) => {
    setBusy(node.nodeId); setError(null)
    try {
      const response = await updateNode.mutateAsync({ nodeId: node.nodeId, patch: { enabled: node.enabled === false } })
      if (!response.success) throw new Error(response.error || '节点状态更新失败')
      toast.success(node.enabled === false ? '节点已启用纳管' : '节点已暂停纳管')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '节点状态更新失败') }
    finally { setBusy(null) }
  }

  const remove = async (node: NodeStatus) => {
    if (!window.confirm(`确认删除节点“${node.name}”？此操作会删除控制面档案和 SSH 凭据。`)) return
    setBusy(node.nodeId)
    try {
      const result = await deleteNode.mutateAsync({ nodeId: node.nodeId })
      if (!result.success) throw new Error(result.error || '删除失败')
      setSelId(null); toast.success('节点档案已删除')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '节点删除失败') }
    finally { setBusy(null) }
  }

  // ---- agent lifecycle ----
  const runAgent = async (node: NodeStatus, action: 'start' | 'stop' | 'restart' | 'health') => {
    setBusy(`${node.nodeId}:${action}`); setError(null)
    try {
      const response = action === 'health' ? await healthCheck.mutateAsync(node.nodeId) : await agentAction.mutateAsync({ nodeId: node.nodeId, action })
      if (!response.success) throw new Error(response.error || `${action} 失败`)
      toast.success(action === 'health' ? '健康检查完成' : 'Agent 维护操作完成', { description: node.name })
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Agent 操作失败') }
    finally { setBusy(null) }
  }

  // ---- runtime detection / adoption / monitor editor ----
  const [detections, setDetections] = useState<KernelDetection[]>([])
  const [editorOpen, setEditorOpen] = useState(false)
  const detect = useCallback(async (targetId?: string) => {
    const id = targetId ?? selId
    if (!id) return
    setBusy(`${id}:detect`); setError(null)
    try { setDetections(await apiService.detectKernels({ nodeId: id })) }
    catch (caught) { setError(caught instanceof Error ? caught.message : '运行时检测失败') }
    finally { setBusy(null) }
  }, [selId])

  useEffect(() => { setDetections([]) }, [selId])
  useEffect(() => { if (sel?.nodeId && sel.agent?.deployed && detailTab === 'runtime') detect(sel.nodeId).catch(() => {}) }, [detect, sel?.nodeId, sel?.agent?.deployed, detailTab])

  const redetectAndAdopt = useCallback(async () => {
    if (!sel) return
    setBusy(`${sel.nodeId}:redetect`); setError(null)
    try {
      const fresh = await apiService.detectKernels({ nodeId: sel.nodeId })
      setDetections(fresh)
      const monitored = new Map(sel.configuredKernels.map(i => [i.type, i]))
      const adopted = fresh.filter(i => i.installed && !monitored.has(i.type))
      if (adopted.length === 0) { toast.info('未检测到新安装的协议核心'); return }
      const kernels = [...monitored.values(), ...adopted.map(i => ({ type: i.type, ...(i.defaultConfigPath ? { configPath: i.defaultConfigPath } : {}) }))]
      const result = await updateNodeKernels.mutateAsync({ nodeId: sel.nodeId, kernels })
      if (!result.success) throw new Error(result.error || '纳管失败')
      toast.success(`已纳管：${adopted.map(i => KERNEL_LABEL[i.type]).join('、')}`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '再次检测失败') }
    finally { setBusy(null) }
  }, [sel, updateNodeKernels])

  const saveMonitoring = useCallback(async (kernels: NodeKernelConfig[]) => {
    if (!sel) return
    setBusy(`${sel.nodeId}:monitoring`); setError(null)
    try {
      const result = await updateNodeKernels.mutateAsync({ nodeId: sel.nodeId, kernels })
      if (!result.success) throw new Error(result.error || '监控配置保存失败')
      setEditorOpen(false); toast.success('监控配置已写入远端并通过 Agent 验证')
      await detect(sel.nodeId)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '监控配置保存失败') }
    finally { setBusy(null) }
  }, [detect, sel, updateNodeKernels])

  // ---- deploy tab ----
  const [deployComponent, setDeployComponent] = useState<DeployComponent>('agent')
  const [operation, setOperation] = useState<DeployOperation>('install')
  const [blocked, setBlocked] = useState<Record<string, string[]>>({})
  const preflight = useCallback(async () => {
    if (!sel) return
    setBusy(`${sel.nodeId}:preflight`); setError(null)
    try {
      const response = await apiService.preflightDeployment(sel.nodeId, deployComponent, operation)
      if (!response.success) throw new Error(errorMessage(response.error, 'SSH 预检失败'))
      const failed = response.data?.checks.filter(c => !c.ok) ?? []
      setBlocked(prev => ({ ...prev, [sel.nodeId]: failed.map(f => f.label) }))
      if (failed.length) toast.warning('预检完成，存在阻断项', { description: failed.map(f => f.label).join('、') })
      else toast.success(sel.nodeId === 'local' ? '本机预检通过' : 'SSH 预检通过', { description: `${response.data?.architecture || '未知架构'} · systemd 可用` })
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'SSH 预检失败') }
    finally { setBusy(null) }
  }, [sel, deployComponent, operation])

  const submitDeploy = useCallback(async () => {
    if (!sel) return
    const block = blocked[sel.nodeId] ?? []
    if (block.length) { setError(`SSH 预检存在阻断项，请先修复：${block.join('、')}`); return }
    setBusy(`${sel.nodeId}:deploy`); setError(null)
    try {
      const response = await startDeployment.mutateAsync({ nodeId: sel.nodeId, component: deployComponent, operation, options: { preserveConfig: true, preserveData: true } })
      if (!response.success) throw new Error(errorMessage(response.error, '创建部署任务失败'))
      toast.success('部署任务已进入队列', { description: `${sel.name} · ${deployComponent}` })
    } catch (caught) { const m = caught instanceof Error ? caught.message : '创建部署任务失败'; setError(m); toast.error('部署任务创建失败', { description: m }) }
    finally { setBusy(null) }
  }, [sel, blocked, deployComponent, operation, startDeployment])

  // ---- deploy tasks + SSE ----
  const taskList = useMemo(() => Object.values(tasks).sort((a, b) => b.startedAt - a.startedAt), [tasks])
  const activeTasks = useMemo(() => taskList.filter(t => t.status === 'running' || t.status === 'pending'), [taskList])
  const timelineRef = useRef(readTimeline())
  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.clusterStatus }),
      queryClient.invalidateQueries({ queryKey: queryKeys.componentDeployments() }),
    ])
  }, [queryClient])
  useEffect(() => {
    const controllers = activeTasks.map(task => {
      const controller = new AbortController()
      const lastEventId = timelineRef.current[task.taskId]?.at(-1)?.eventId
      streamServerEvents(`/api/deployments/${encodeURIComponent(task.taskId)}/events`, {
        ...(lastEventId ? { lastEventId } : {}), signal: controller.signal,
        onMessage: message => {
          if (message.event !== 'progress') return
          try {
            const ev = JSON.parse(message.data) as DeploymentEvent
            const known = timelineRef.current[task.taskId] ?? []
            if (!known.some(k => k.eventId === ev.eventId)) {
              timelineRef.current = { ...timelineRef.current, [task.taskId]: [...known, ev] }
              try { window.sessionStorage.setItem(TIMELINE_KEY, JSON.stringify(timelineRef.current)) } catch { /* noop */ }
            }
          } catch { /* ignore */ }
          refresh().catch(() => {})
        },
      }).catch(() => {})
      return controller
    })
    return () => controllers.forEach(c => c.abort())
  }, [activeTasks.map(t => t.taskId).join(','), refresh])

  const retryTask = async (task: ComponentDeployStatus) => {
    try { const r = await retryDeployment.mutateAsync(task.taskId); if (!r.success) throw new Error(errorMessage(r.error, '无法重试该任务')); toast.success('已按原始输入创建重试任务') }
    catch (caught) { toast.error('重试失败', { description: caught instanceof Error ? caught.message : '无法重试该任务' }) }
  }
  const cancelTask = async (task: ComponentDeployStatus) => {
    try { const r = await cancelDeployment.mutateAsync(task.taskId); if (!r.success) throw new Error(errorMessage(r.error, '任务已进入不可取消阶段')); toast.success('任务已取消') }
    catch (caught) { toast.error('取消失败', { description: caught instanceof Error ? caught.message : '任务已进入不可取消阶段' }) }
  }

  const completeAdd = useCallback(async (nodeId?: string) => {
    setAddOpen(false)
    const next = new URLSearchParams(params); next.delete('intent'); setParams(next)
    await clusterQuery.refetch()
    toast.success('节点档案已创建', { description: '尚未安装任何组件，请在部署标签页安装。' })
    if (nodeId) { setSelId(nodeId); setDetailTab('deploy') }
  }, [params, setParams, clusterQuery])

  const selectNode = (id: string) => { setSelId(prev => prev === id ? null : id); setDetailTab('overview') }
  const block = sel ? blocked[sel.nodeId] ?? [] : []

  return (
    <>
      <PageHeader
        title="节点"
        description="档案、部署、Agent 与运行时集中在这里；点击行展开详情。"
        actions={<button onClick={() => setAddOpen(true)} className="mb-pill-btn primary"><Icon icon="ph:plus-bold" />添加节点</button>}
      />

      {error ? (
        <div className="garden-alert garden-alert-danger" style={{ borderRadius: 14, marginBottom: 12 }}>
          <Icon icon="ph:warning-circle-light" className="mt-0.5 size-5 shrink-0" />
          <div><p className="font-semibold">节点操作失败</p><p className="text-xs">{error}</p></div>
        </div>
      ) : null}

      <div className="mb-3 flex gap-2">
        <div className="relative max-w-[340px] flex-1">
          <Icon icon="ph:magnifying-glass-light" style={{ position: 'absolute', left: 11, top: 9, fontSize: 15, color: 'var(--muted-foreground)' }} />
          <input
            value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索名称、主机、地域…"
            style={{ width: '100%', height: 33, padding: '0 12px 0 32px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', color: 'var(--foreground)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <select
          value={filter} onChange={e => setFilter(e.target.value as Filter)}
          style={{ height: 33, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', color: 'var(--foreground)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }}
        >
          <option value="all">全部节点</option><option value="enabled">已启用</option><option value="disabled">已暂停</option><option value="undeployed">Agent 未安装</option>
        </select>
      </div>

      <div className="grid items-start gap-[14px]" style={{ gridTemplateColumns: hasSel ? 'minmax(0,1fr) 400px' : '1fr' }}>
        {/* node table */}
        <div className="mb-card min-w-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="mb-table" style={{ minWidth: 420 }}>
              <thead>
                <tr>
                  <th className="mb-th" style={{ padding: '8px 16px' }}>节点</th>
                  <th className="mb-th" style={{ padding: '8px 10px' }}>Agent</th>
                  <th className="mb-th" style={{ padding: '8px 10px' }}>内核</th>
                  <th className="mb-th" style={{ padding: '8px 16px', textAlign: 'right' }}>延迟</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map(node => {
                  const tone = agentTone(node)
                  const active = selId === node.nodeId
                  const kernelsLabel = node.configuredKernels.map(k => KERNEL_LABEL[k.type]).join(' · ') || '无'
                  return (
                    <tr key={node.nodeId} onClick={() => selectNode(node.nodeId)} className="mb-hover" style={{ cursor: 'pointer', background: active ? 'var(--card2)' : undefined }}>
                      <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontWeight: 600, fontSize: 12.5 }}>{node.name}</span><br />
                        <span className="signal-mono" style={{ fontSize: 10.5, color: 'var(--muted-foreground)' }}>{node.host || '本机'} · {node.location}</span>
                      </td>
                      <td style={{ padding: '10px 10px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 99, background: tone === 'muted' ? 'var(--card2)' : `var(--${tone}-bg)`, color: tone === 'muted' ? 'var(--muted-foreground)' : `var(--${tone})`, fontSize: 11, fontWeight: 600 }}>
                          <span style={{ width: 5, height: 5, borderRadius: 99, background: tone === 'muted' ? 'var(--muted-foreground)' : `var(--${tone})` }} />{agentLabel(node)}
                        </span>
                      </td>
                      <td style={{ padding: '10px 10px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--muted-foreground)' }}>{kernelsLabel}</td>
                      <td className="signal-mono" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 11.5 }}>{node.latency ? `${node.latency}ms` : '—'}</td>
                    </tr>
                  )
                })}
                {nodes.length === 0 ? <tr><td colSpan={4} style={{ padding: 28, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 12 }}>没有匹配的节点。</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* detail panel */}
        {sel ? (
          <div className="mb-card min-w-0 overflow-hidden">
            <div style={{ padding: '14px 16px 0' }}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 700 }}>{sel.name}</h2>
                  <p className="signal-mono" style={{ margin: '2px 0 0', fontSize: 10.5, color: 'var(--muted-foreground)' }}>
                    {sel.nodeId === 'local' ? '本机直接执行' : `${sel.sshUser || 'root'}@${sel.host || '-'}:${sel.sshPort || 22}`}
                  </p>
                </div>
                <button onClick={() => setSelId(null)} style={{ border: 'none', background: 'transparent', color: 'var(--muted-foreground)', cursor: 'pointer', padding: 2 }}><Icon icon="ph:x-bold" style={{ fontSize: 14 }} /></button>
              </div>
              <div className="mt-3 flex gap-0.5" style={{ borderBottom: '1px solid var(--border)' }}>
                {DETAIL_TABS.map(t => {
                  const active = detailTab === t.key
                  return (
                    <button key={t.key} onClick={() => setDetailTab(t.key)} style={{ height: 32, padding: '0 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: active ? 'var(--primary)' : 'var(--muted-foreground)', borderBottom: `2px solid ${active ? 'var(--primary)' : 'transparent'}`, marginBottom: -1 }}>{t.label}</button>
                  )
                })}
              </div>
            </div>
            <div style={{ padding: '14px 16px 16px' }}>
              {detailTab === 'overview' ? (
                <>
                  <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <Cell label="纳管状态">{sel.enabled === false ? '已暂停' : '纳管中'}</Cell>
                    <Cell label="地域标签">{sel.location}</Cell>
                    <div style={{ gridColumn: 'span 2', padding: '9px 12px', borderRadius: 10, background: 'var(--card2)' }}>
                      <p style={{ margin: 0, fontSize: 10.5, color: 'var(--muted-foreground)' }}>已配置核心</p>
                      <p style={{ margin: '2px 0 0', fontSize: 12.5, fontWeight: 600 }}>{sel.configuredKernels.map(k => KERNEL_LABEL[k.type]).join(' · ') || '无'}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <button className={smallBtn} style={smallBtnStyle} onClick={() => openEdit(sel)}>编辑档案</button>
                    <button className={smallBtn} style={smallBtnStyle} disabled={busy === sel.nodeId} onClick={() => toggleEnabled(sel)}>{sel.enabled === false ? '启用纳管' : '暂停纳管'}</button>
                    {sel.nodeId !== 'local' ? <button className={smallBtn} style={{ ...smallBtnStyle, color: 'var(--danger)' }} disabled={busy === sel.nodeId} onClick={() => remove(sel)}>删除</button> : null}
                  </div>
                </>
              ) : null}

              {detailTab === 'deploy' ? (
                <>
                  <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: 'var(--muted-foreground)' }}>组件</p>
                  <div className="flex flex-wrap gap-1.5">
                    {DEPLOY_COMPONENTS.map(c => <Chip key={c} active={deployComponent === c} onClick={() => setDeployComponent(c)}>{COMPONENT_LABEL[c]}</Chip>)}
                  </div>
                  <p style={{ margin: '12px 0 6px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: 'var(--muted-foreground)' }}>操作</p>
                  <select value={operation} onChange={e => setOperation(e.target.value as DeployOperation)} style={{ width: '100%', height: 33, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', color: 'var(--foreground)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}>
                    {OPERATIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <div style={{ marginTop: 10, padding: '9px 12px', borderRadius: 10, background: 'var(--card2)', fontSize: 11.5, color: 'var(--muted-foreground)' }}>
                    任务边界：{sel.name} · {COMPONENT_LABEL[deployComponent]} · 同节点同组件互斥。{installed(sel, deployComponent) ? '当前已安装。' : '当前未安装。'}
                  </div>
                  {block.length ? <div style={{ marginTop: 8, padding: '9px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 11.5 }}>预检阻断项：{block.join('、')}。修复后重新预检。</div> : null}
                  <div className="mt-3 flex gap-1.5">
                    <button className={smallBtn} style={{ flex: 1, height: 32, borderRadius: 99 }} disabled={busy === `${sel.nodeId}:preflight`} onClick={preflight}>{busy === `${sel.nodeId}:preflight` ? '预检中…' : sel.nodeId === 'local' ? '本机预检' : 'SSH 预检'}</button>
                    <button className={`${smallBtn} primary`} style={{ flex: 1.4, height: 32, borderRadius: 99 }} disabled={busy === `${sel.nodeId}:deploy` || block.length > 0} onClick={submitDeploy}>创建部署任务</button>
                  </div>
                </>
              ) : null}

              {detailTab === 'agent' ? (
                <>
                  <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <Cell label="版本"><span className="signal-mono">{sel.agent?.version || '—'}</span></Cell>
                    <Cell label="监听端口"><span className="signal-mono">{sel.agent?.deployed ? sel.agent?.port || 3001 : '—'}</span></Cell>
                    <Cell label="心跳延迟"><span className="signal-mono">{sel.latency ? `${sel.latency}ms` : '—'}</span></Cell>
                    <Cell label="运行时间"><span className="signal-mono">{sel.uptime ? `${Math.floor(sel.uptime / 60)}m` : '—'}</span></Cell>
                    <div style={{ gridColumn: 'span 2', padding: '9px 12px', borderRadius: 10, background: 'var(--card2)' }}>
                      <p style={{ margin: 0, fontSize: 10.5, color: 'var(--muted-foreground)' }}>最近错误</p>
                      <p style={{ margin: '2px 0 0', fontSize: 12, wordBreak: 'break-all' }}>{sel.lastError || sel.error || '无'}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {sel.agent?.status === 'stopped' ? <button className={smallBtn} style={smallBtnStyle} disabled={busy !== null} onClick={() => runAgent(sel, 'start')}>启动</button> : null}
                    {sel.agent?.status === 'running' ? <button className={smallBtn} style={smallBtnStyle} disabled={busy !== null} onClick={() => runAgent(sel, 'stop')}>停止</button> : null}
                    {sel.agent?.deployed ? <button className={smallBtn} style={smallBtnStyle} disabled={busy !== null} onClick={() => runAgent(sel, 'restart')}>重启</button> : null}
                    {sel.agent?.deployed ? <button className={smallBtn} style={smallBtnStyle} disabled={busy !== null} onClick={() => runAgent(sel, 'health')}>健康检查</button> : null}
                    <Link to={`/logs?node=${encodeURIComponent(sel.nodeId)}`} className={smallBtn} style={smallBtnStyle}>查看日志</Link>
                  </div>
                </>
              ) : null}

              {detailTab === 'runtime' ? (
                <>
                  <div className="flex flex-col gap-2">
                    <RuntimeRow name="mihomo" tone={sel.mihomoAvailable ? 'success' : 'muted'} status={sel.mihomoAvailable ? '可用' : '未安装'} path={sel.mihomoAvailable ? 'CLI 转换器' : '—'} detail={`v${sel.mihomoVersion || '版本未知'}`} />
                    {KERNEL_TYPES.map(type => {
                      const runtime = sel.kernels.find(k => k.type === type)
                      const detected = detections.find(d => d.type === type)
                      const monitored = sel.configuredKernels.some(k => k.type === type)
                      const isInstalled = Boolean(detected?.installed || runtime?.detected)
                      const tone: 'success' | 'warning' | 'muted' = monitored ? 'success' : isInstalled ? 'warning' : 'muted'
                      const status = monitored ? '已监控' : isInstalled ? '未监控' : '未安装'
                      const path = sel.configuredKernels.find(k => k.type === type)?.configPath || detected?.defaultConfigPath || runtime?.binaryPath || '—'
                      const detail = monitored ? `运行中 · ${runtime?.accessible ? '可读' : runtime?.error || '状态未知'} · ${runtime?.nodesCount ?? 0} 个来源` : isInstalled ? '已安装 · 未写入 Agent 配置' : '通过部署标签页安装后自动纳管'
                      return <RuntimeRow key={type} name={KERNEL_LABEL[type]} tone={tone} status={status} path={path} detail={detail} />
                    })}
                  </div>
                  <div className="mt-3 flex gap-1.5">
                    <button className={smallBtn} style={smallBtnStyle} disabled={busy !== null || !sel.agent?.deployed} onClick={redetectAndAdopt}>重新检测</button>
                    <button className={smallBtn} style={smallBtnStyle} disabled={!sel.agent?.deployed || detections.length === 0} onClick={() => setEditorOpen(true)}>编辑监控范围</button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* 部署任务 */}
      <section className="mb-card mt-[14px] overflow-hidden">
        <div className="flex items-center justify-between px-[18px] pb-2 pt-3">
          <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>部署任务</h2>
          <span style={{ fontSize: 11.5, color: 'var(--muted-foreground)' }}>{activeTasks.length} 个执行中 · SSE 实时更新</span>
        </div>
        <table className="mb-table">
          <tbody>
            {taskList.map(task => {
              const node = allNodes.find(n => n.nodeId === task.nodeId)
              const tone = task.status === 'success' ? 'success' : task.status === 'error' ? 'danger' : task.status === 'cancelled' ? 'muted' : 'warning'
              const statusText = task.status === 'success' ? '成功' : task.status === 'error' ? '失败' : task.status === 'cancelled' ? '已取消' : task.status === 'pending' ? '排队中' : '执行中'
              const cancellable = task.status === 'pending' || (task.status === 'running' && task.step === 'prechecking')
              return (
                <tr key={task.taskId}>
                  <td style={{ padding: '9px 18px', borderTop: '1px solid var(--border)', width: '30%' }}>
                    <span style={{ fontWeight: 600, fontSize: 12.5 }}>{node?.name || task.nodeId} · {task.component}</span><br />
                    <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{task.operation} · {STEP_LABELS[task.step] || task.step} · {new Date(task.startedAt).toLocaleTimeString('zh-CN')}</span>
                  </td>
                  <td style={{ padding: '9px 10px', borderTop: '1px solid var(--border)', width: '34%' }}>
                    <div style={{ height: 5, borderRadius: 99, background: 'var(--card2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${task.progress}%`, borderRadius: 99, background: task.status === 'error' ? 'var(--danger)' : 'var(--primary)' }} />
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 11, color: task.status === 'error' ? 'var(--danger)' : 'var(--muted-foreground)' }}>{task.message}</p>
                  </td>
                  <td style={{ padding: '9px 10px', borderTop: '1px solid var(--border)' }}>
                    <span style={{ display: 'inline-flex', padding: '2px 9px', borderRadius: 99, background: tone === 'muted' ? 'var(--card2)' : `var(--${tone}-bg)`, color: tone === 'muted' ? 'var(--muted-foreground)' : `var(--${tone})`, fontSize: 11, fontWeight: 600 }}>{statusText}</span>
                  </td>
                  <td style={{ padding: '9px 18px', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                    <span style={{ display: 'inline-flex', gap: 6 }}>
                      {cancellable ? <button className={smallBtn} style={{ height: 26, padding: '0 10px', fontSize: 11, borderRadius: 99 }} onClick={() => cancelTask(task)}>取消</button> : null}
                      {task.status === 'error' || task.status === 'cancelled' ? <button className={smallBtn} style={{ height: 26, padding: '0 10px', fontSize: 11, borderRadius: 99 }} onClick={() => retryTask(task)}>重试</button> : null}
                      <Link to={`/logs?node=${encodeURIComponent(task.nodeId)}&task=${encodeURIComponent(task.taskId)}`} className={smallBtn} style={{ height: 26, padding: '0 10px', fontSize: 11, borderRadius: 99 }}>日志</Link>
                    </span>
                  </td>
                </tr>
              )
            })}
            {taskList.length === 0 ? <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 12, borderTop: '1px solid var(--border)' }}>暂无部署任务。任务创建后会持久化并在刷新后恢复。</td></tr> : null}
          </tbody>
        </table>
      </section>

      {/* edit profile dialog */}
      <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open) setEditing(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑节点档案</DialogTitle>
            <DialogDescription>{editing?.nodeId === 'local' ? '本机节点固定通过回环地址直接执行。' : '修改主机会清除已确认的 host key，下次部署前需要重新预检。'}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2"><Label htmlFor="edit-name">名称</Label><Input id="edit-name" value={draft.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="grid gap-2"><Label htmlFor="edit-host">主机</Label><Input id="edit-host" value={draft.host} disabled={editing?.nodeId === 'local'} onChange={e => setDraft(p => ({ ...p, host: e.target.value }))} /></div>
            <div className="grid gap-2"><Label htmlFor="edit-location">地域标签</Label><Input id="edit-location" value={draft.location} onChange={e => setDraft(p => ({ ...p, location: e.target.value }))} /></div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2"><Label htmlFor="edit-ssh-user">用户名</Label><Input id="edit-ssh-user" value={draft.sshUser} onChange={e => setDraft(p => ({ ...p, sshUser: e.target.value }))} /></div>
              {editing?.nodeId !== 'local' ? <div className="grid gap-2"><Label htmlFor="edit-ssh-port">SSH 端口</Label><Input id="edit-ssh-port" inputMode="numeric" value={draft.sshPort} onChange={e => setDraft(p => ({ ...p, sshPort: e.target.value }))} /></div> : null}
            </div>
            {editing?.nodeId !== 'local' ? (
              <div className="grid gap-2">
                <span className="text-sm font-medium">认证方式</span>
                <div className="flex gap-2">
                  {(['password', 'privateKey'] as const).map(method => (
                    <Button key={method} type="button" size="sm" variant={draft.sshAuthMethod === method ? 'default' : 'outline'} aria-pressed={draft.sshAuthMethod === method} onClick={() => setDraft(p => ({ ...p, sshAuthMethod: method, sshCredential: '' }))}>{method === 'password' ? '密码' : '私钥'}</Button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="edit-ssh-credential">{editing?.nodeId !== 'local' && draft.sshAuthMethod === 'privateKey' ? '私钥' : '密码'}</Label>
              <Input id="edit-ssh-credential" type="password" autoComplete="new-password" value={draft.sshCredential} onChange={e => setDraft(p => ({ ...p, sshCredential: e.target.value }))} placeholder={draft.sshUser.trim() === 'root' ? 'root 凭据仅供下一次部署使用，不保存' : '留空保留现有凭据；普通用户凭据默认保存'} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={saveEdit} disabled={Boolean(busy)}>保存档案</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editorOpen && sel ? (
        <KernelDetectionDialog open detections={detections} monitored={sel.configuredKernels} submitting={busy === `${sel.nodeId}:monitoring`} error={error} confirmLabel="保存并验证监控配置" onCancel={() => setEditorOpen(false)} onConfirm={saveMonitoring} />
      ) : null}

      <AddNodeForm isOpen={addOpen} onClose={() => setAddOpen(false)} onComplete={completeAdd} />
    </>
  )
}

function RuntimeRow({ name, tone, status, path, detail }: { name: string; tone: 'success' | 'warning' | 'muted'; status: string; path: string; detail: string }) {
  return (
    <div style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card2)' }}>
      <div className="flex items-center justify-between gap-2">
        <span style={{ fontWeight: 600, fontSize: 12.5 }}>{name}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 99, background: tone === 'muted' ? 'var(--card2)' : `var(--${tone}-bg)`, color: tone === 'muted' ? 'var(--muted-foreground)' : `var(--${tone})`, fontSize: 10.5, fontWeight: 600 }}>{status}</span>
      </div>
      <p className="signal-mono" style={{ margin: '4px 0 0', fontSize: 10.5, color: 'var(--muted-foreground)', wordBreak: 'break-all' }}>{path}</p>
      <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--muted-foreground)' }}>{detail}</p>
    </div>
  )
}
