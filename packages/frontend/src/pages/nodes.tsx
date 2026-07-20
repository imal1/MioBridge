import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { apiService } from '@/lib/api'
import type { ClusterStatus, NodeStatus, SshAuthMethod } from '@/lib/types'
import { AddNodeForm } from '@/components/cluster/AddNodeForm'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import SignalPage from '@/components/shared/SignalPage'

type Filter = 'all' | 'enabled' | 'disabled' | 'undeployed'

export default function NodesPage() {
  const [params, setParams] = useSearchParams()
  const [cluster, setCluster] = useState<ClusterStatus | null>(null)
  const [addOpen, setAddOpen] = useState(params.get('intent') === 'add')
  const [editing, setEditing] = useState<NodeStatus | null>(null)
  const [draft, setDraft] = useState({
    name: '', host: '', location: '', tags: '',
    sshUser: 'root', sshPort: '22', sshAuthMethod: 'password' as SshAuthMethod, sshCredential: '',
  })
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await apiService.getClusterStatus()
    if (result.success) setCluster(result.data as ClusterStatus)
  }, [])
  useEffect(() => { refresh().catch(caught => setError(caught instanceof Error ? caught.message : '节点加载失败')) }, [refresh])

  const nodes = useMemo(() => (cluster?.nodes || []).filter(node => {
    if (filter === 'enabled' && node.enabled === false) return false
    if (filter === 'disabled' && node.enabled !== false) return false
    if (filter === 'undeployed' && node.agent?.deployed) return false
    const needle = query.trim().toLowerCase()
    return !needle || [node.name, node.host, node.location, node.nodeId, ...(node.tags || [])].some(value => value?.toLowerCase().includes(needle))
  }), [cluster?.nodes, filter, query])

  const completeAdd = useCallback(async (nodeId?: string) => {
    setAddOpen(false)
    const next = new URLSearchParams(params); next.delete('intent'); setParams(next)
    await refresh()
    toast.success('节点档案已创建', { description: '尚未安装任何组件，请前往部署中心。' })
    if (nodeId) setParams({ node: nodeId })
  }, [params, refresh, setParams])

  const openEdit = (node: NodeStatus) => {
    setEditing(node)
    setDraft({
      name: node.name, host: node.host || '', location: node.location, tags: (node.tags || []).join(', '),
      sshUser: node.sshUser || 'root', sshPort: String(node.sshPort ?? 22),
      // 认证方式必须取节点现状：写死 'password' 会让私钥节点一打开编辑框就显示错误状态。
      sshAuthMethod: node.sshAuthMethod ?? 'password',
      // 凭据只写不读：编辑框始终从空开始，留空表示保留现有凭据。
      sshCredential: '',
    })
  }
  const saveEdit = async () => {
    if (!editing) return
    setBusy(editing.nodeId); setError(null)
    try {
      const { tags, sshPort, sshAuthMethod, sshCredential, ...rest } = draft
      const isLocal = editing.nodeId === 'local'
      const response = await apiService.updateNode(editing.nodeId, {
        ...rest,
        tags: tags.split(',').map(value => value.trim()).filter(Boolean),
        ...(!isLocal ? { sshPort: Number(sshPort) || 22 } : {}),
        // 认证方式只随新凭据一起提交：服务端收到该字段就会覆盖，单独发送会把
        // 私钥节点静默翻成无凭据的密码认证，之后所有 SSH 操作都会失败。
        ...(!isLocal && sshCredential
          ? sshAuthMethod === 'password'
            ? { sshAuthMethod, sshPassword: sshCredential }
            : { sshAuthMethod, sshPrivateKey: sshCredential }
          : {}),
      })
      if (!response.success) throw new Error(response.error || '节点更新失败')
      setEditing(null); await refresh(); toast.success('节点档案已更新')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '节点更新失败') }
    finally { setBusy(null) }
  }

  const toggleEnabled = async (node: NodeStatus) => {
    setBusy(node.nodeId); setError(null)
    try {
      // HTTP 200 也可能携带 success:false；忽略它会让界面谎报“已暂停/已启用”。
      const response = await apiService.updateNode(node.nodeId, { enabled: node.enabled === false })
      if (!response.success) throw new Error(response.error || '节点状态更新失败')
      await refresh(); toast.success(node.enabled === false ? '节点已启用纳管' : '节点已暂停纳管')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '节点状态更新失败') }
    finally { setBusy(null) }
  }

  const remove = async (node: NodeStatus) => {
    if (!window.confirm(`确认删除节点“${node.name}”？此操作会删除控制面档案和 SSH 凭据。`)) return
    setBusy(node.nodeId)
    try {
      const result = await apiService.deleteNode(node.nodeId)
      if (!result.success) throw new Error(result.error || '删除失败')
      await refresh(); toast.success('节点档案已删除')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '节点删除失败') }
    finally { setBusy(null) }
  }

  return <SignalPage crumb="Node inventory" title="节点" description="管理节点档案、SSH 连接和纳管状态；软件安装与运行维护由后续页面负责。" status={`${cluster?.totalNodes || 0} 个节点档案`} maxWidth="narrow" actions={<><Button variant="outline" onClick={refresh}><Icon icon="ph:arrow-clockwise-light" />刷新</Button><Button onClick={() => setAddOpen(true)}><Icon icon="ph:plus-light" />添加节点</Button></>}>
    {error ? <Alert variant="destructive"><AlertTitle>节点操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    <Card className="mb-5"><CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_220px]"><Input aria-label="搜索节点" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索名称、主机、地域或节点 ID…" /><Select aria-label="筛选节点" value={filter} onChange={event => setFilter(event.target.value as Filter)}><option value="all">全部节点</option><option value="enabled">已启用</option><option value="disabled">已暂停</option><option value="undeployed">Agent 未安装</option></Select></CardContent></Card>
    <div className="grid gap-5 lg:grid-cols-2">
      {nodes.map(node => <Card key={node.nodeId}><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{node.name}</CardTitle><CardDescription>{node.host || '主机未返回'} · {node.location} · {node.nodeId}</CardDescription>{node.tags?.length ? <div className="mt-2 flex flex-wrap gap-1">{node.tags.map(tag => <Badge key={tag} variant="outline">{tag}</Badge>)}</div> : null}</div><div className="flex gap-2"><Badge variant={node.enabled === false ? 'outline' : 'secondary'}>{node.enabled === false ? '已暂停' : '纳管中'}</Badge><Badge variant={node.online ? 'secondary' : 'outline'}>{node.online ? 'Agent 在线' : node.agent?.deployed ? 'Agent 异常' : 'Agent 未安装'}</Badge></div></div></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-2xl bg-[var(--surface-container)] p-3"><span className="block text-xs text-muted-foreground">{node.nodeId === 'local' ? '执行方式' : 'SSH'}</span><span className="mt-1 block font-mono">{node.nodeId === 'local' ? '本机直接执行' : `${node.sshUser || 'root'}@${node.host || '-'}:${node.sshPort || 22}`}</span></div><div className="rounded-2xl bg-[var(--surface-container)] p-3"><span className="block text-xs text-muted-foreground">已配置核心</span><span className="mt-1 block">{node.configuredKernels.map(item => item.type).join(' · ') || '无'}</span></div></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openEdit(node)}>编辑档案</Button><Button size="sm" variant="outline" disabled={busy === node.nodeId} onClick={() => toggleEnabled(node)}>{node.enabled === false ? '启用纳管' : '暂停纳管'}</Button><Button asChild size="sm"><Link to={`/deploy?node=${encodeURIComponent(node.nodeId)}&component=agent`}>{node.agent?.deployed ? '查看部署' : '部署 Agent'}</Link></Button>{node.nodeId !== 'local' && (!node.agent?.deployed ? <Button size="sm" variant="destructive" disabled={busy === node.nodeId} onClick={() => remove(node)}>删除</Button> : <Button asChild size="sm" variant="outline"><Link to={`/deploy?node=${encodeURIComponent(node.nodeId)}&component=agent&operation=uninstall`}>先卸载再删除</Link></Button>)}</div></CardContent></Card>)}
      {nodes.length === 0 ? <Card><CardContent className="p-10 text-center"><p className="text-muted-foreground">没有匹配的节点。</p><Button className="mt-4" onClick={() => setAddOpen(true)}>添加第一个节点</Button></CardContent></Card> : null}
    </div>

    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open) setEditing(null) }}><DialogContent><DialogHeader><DialogTitle>编辑节点档案</DialogTitle><DialogDescription>{editing?.nodeId === 'local' ? '本机节点固定通过回环地址直接执行，不需要 SSH 凭据。' : '修改主机会清除已确认的 host key，下次部署前需要重新预检。'}</DialogDescription></DialogHeader><div className="grid gap-4 py-4"><div className="grid gap-2"><Label htmlFor="edit-name">名称</Label><Input id="edit-name" value={draft.name} onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))} /></div><div className="grid gap-2"><Label htmlFor="edit-host">主机</Label><Input id="edit-host" value={draft.host} disabled={editing?.nodeId === 'local'} onChange={event => setDraft(previous => ({ ...previous, host: event.target.value }))} /></div><div className="grid gap-2"><Label htmlFor="edit-location">地域</Label><Input id="edit-location" value={draft.location} onChange={event => setDraft(previous => ({ ...previous, location: event.target.value }))} /></div><div className="grid gap-2"><Label htmlFor="edit-tags">标签</Label><Input id="edit-tags" value={draft.tags} onChange={event => setDraft(previous => ({ ...previous, tags: event.target.value }))} placeholder="production, asia" /></div>
      {editing?.nodeId !== 'local' ? <><div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-2"><Label htmlFor="edit-ssh-user">SSH 用户</Label><Input id="edit-ssh-user" value={draft.sshUser} onChange={event => setDraft(previous => ({ ...previous, sshUser: event.target.value }))} /></div>
        <div className="grid gap-2"><Label htmlFor="edit-ssh-port">SSH 端口</Label><Input id="edit-ssh-port" inputMode="numeric" value={draft.sshPort} onChange={event => setDraft(previous => ({ ...previous, sshPort: event.target.value }))} /></div>
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-medium">认证方式</span>
        <div className="flex gap-2">
          {(['password', 'privateKey'] as const).map(method => (
            <Button key={method} type="button" size="sm" variant={draft.sshAuthMethod === method ? 'default' : 'outline'} aria-pressed={draft.sshAuthMethod === method} onClick={() => setDraft(previous => ({ ...previous, sshAuthMethod: method, sshCredential: '' }))}>
              {method === 'password' ? '密码' : '私钥'}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="edit-ssh-credential">{draft.sshAuthMethod === 'password' ? 'SSH 密码' : 'SSH 私钥'}</Label>
        <Input id="edit-ssh-credential" type="password" autoComplete="new-password" value={draft.sshCredential} onChange={event => setDraft(previous => ({ ...previous, sshCredential: event.target.value }))} placeholder="留空表示保留现有凭据" />
        <span className="text-xs text-muted-foreground">凭据只写不读；填写后会整体替换该节点已保存的凭据。</span>
      </div></> : null}</div><DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>取消</Button><Button onClick={saveEdit} disabled={Boolean(busy)}>保存档案</Button></DialogFooter></DialogContent></Dialog>
    <AddNodeForm isOpen={addOpen} onClose={() => setAddOpen(false)} onComplete={completeAdd} />
  </SignalPage>
}
