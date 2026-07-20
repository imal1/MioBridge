import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { apiService, type NodePreflightResult } from '@/lib/api'
import type { KernelType, SshAuthMethod } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface NodeFormData {
  name: string
  host: string
  location: string
  sshUser: string
  sshPort: string
  sshAuthMethod: SshAuthMethod
  sshPassword: string
  sshPrivateKey: string
  sshPrivateKeyName: string
}

interface AddNodeFormProps {
  isOpen: boolean
  onClose: () => void
  onComplete: (nodeId?: string) => void | Promise<void>
  preflightNode?: typeof apiService.preflightNode
  createNode?: typeof apiService.addNode
  // Kept temporarily so older callers compile during the route migration.
  monitoredTypes?: KernelType[]
  detectKernels?: typeof apiService.detectKernels
  deployNode?: typeof apiService.deployNode
}

const EMPTY: NodeFormData = {
  name: '', host: '', location: '', sshUser: 'root', sshPort: '22',
  sshAuthMethod: 'password', sshPassword: '', sshPrivateKey: '', sshPrivateKeyName: '',
}

export function AddNodeForm({
  isOpen, onClose, onComplete,
  preflightNode = ssh => apiService.preflightNode(ssh),
  createNode = payload => apiService.addNode(payload),
}: AddNodeFormProps) {
  const [form, setForm] = useState<NodeFormData>(EMPTY)
  const [preflight, setPreflight] = useState<NodePreflightResult | null>(null)
  const [loading, setLoading] = useState<'preflight' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const reset = useCallback(() => { generation.current += 1; setForm(EMPTY); setPreflight(null); setLoading(null); setError(null) }, [])
  useEffect(() => { if (!isOpen) reset() }, [isOpen, reset])
  if (!isOpen) return null

  const update = (field: keyof NodeFormData, value: string) => {
    setForm(previous => ({ ...previous, [field]: value }))
    setPreflight(null)
  }
  const sshPayload = () => ({
    host: form.host.trim(), user: form.sshUser.trim(), port: Number(form.sshPort), authMethod: form.sshAuthMethod,
    ...(form.sshAuthMethod === 'password' ? { password: form.sshPassword } : { privateKey: form.sshPrivateKey }),
  })

  const runPreflight = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading('preflight'); setError(null)
    const requestGeneration = generation.current
    try {
      const result = await preflightNode(sshPayload())
      if (generation.current !== requestGeneration) return
      if (!result.success || !result.data) throw new Error(result.error || 'SSH 预检失败')
      setPreflight(result.data)
    } catch (caught) { if (generation.current === requestGeneration) setError(caught instanceof Error ? caught.message : 'SSH 预检失败') }
    finally { if (generation.current === requestGeneration) setLoading(null) }
  }

  const save = async () => {
    if (!preflight || preflight.checks.some(item => !item.ok)) return
    setLoading('save'); setError(null)
    const requestGeneration = generation.current
    try {
      const result = await createNode({
        name: form.name.trim(), host: form.host.trim(), location: form.location.trim(), kernels: [],
        sshUser: form.sshUser.trim(), sshPort: Number(form.sshPort), sshHostKey: preflight.hostKey, sshAuthMethod: form.sshAuthMethod,
        ...(form.sshAuthMethod === 'password' ? { sshPassword: form.sshPassword } : { sshPrivateKey: form.sshPrivateKey, sshPrivateKeyName: form.sshPrivateKeyName }),
      })
      if (!result.success || !result.data?.id) throw new Error(result.error || '节点保存失败')
      const nodeId = result.data.id
      if (generation.current !== requestGeneration) return
      reset(); await onComplete(nodeId)
    } catch (caught) { if (generation.current === requestGeneration) setError(caught instanceof Error ? caught.message : '节点保存失败') }
    finally { if (generation.current === requestGeneration) setLoading(null) }
  }

  const uploadKey = (file?: File) => {
    if (!file) return
    const requestGeneration = generation.current
    const reader = new FileReader()
    reader.onload = () => {
      if (generation.current !== requestGeneration) return
      setForm(previous => ({ ...previous, sshPrivateKey: typeof reader.result === 'string' ? reader.result : '', sshPrivateKeyName: file.name }))
    }
    reader.readAsText(file)
  }

  return <Dialog open={isOpen} onOpenChange={open => { if (!open && !loading) onClose() }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <form onSubmit={runPreflight}>
        <DialogHeader><DialogTitle>添加节点</DialogTitle><DialogDescription>先保存节点档案并确认 SSH 预检；不会隐式安装 Agent 或协议核心。</DialogDescription></DialogHeader>
        <div className="grid gap-4 py-4">
          {error ? <Alert variant="destructive"><AlertTitle>节点校验失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          <div className="grid gap-2"><Label htmlFor="node-name">节点名称</Label><Input id="node-name" value={form.name} onChange={event => update('name', event.target.value)} required /></div>
          <div className="grid gap-2"><Label htmlFor="node-host">主机地址</Label><Input id="node-host" value={form.host} onChange={event => update('host', event.target.value)} required /></div>
          <div className="grid gap-2"><Label htmlFor="node-location">地域标签</Label><Input id="node-location" value={form.location} onChange={event => update('location', event.target.value)} required /></div>
          <h3 className="text-sm font-semibold text-muted-foreground">SSH 连接信息</h3>
          <div className="grid grid-cols-[1fr_110px] gap-3"><div className="grid gap-2"><Label htmlFor="ssh-user">用户名</Label><Input id="ssh-user" value={form.sshUser} onChange={event => update('sshUser', event.target.value)} required /></div><div className="grid gap-2"><Label htmlFor="ssh-port">端口</Label><Input id="ssh-port" inputMode="numeric" value={form.sshPort} onChange={event => update('sshPort', event.target.value)} required /></div></div>
          <div className="grid gap-2"><Label>SSH 认证</Label><div className="flex gap-2"><Button type="button" size="sm" variant={form.sshAuthMethod === 'password' ? 'default' : 'outline'} onClick={() => update('sshAuthMethod', 'password')}>密码</Button><Button type="button" size="sm" variant={form.sshAuthMethod === 'privateKey' ? 'default' : 'outline'} onClick={() => update('sshAuthMethod', 'privateKey')}>私钥</Button></div></div>
          {form.sshAuthMethod === 'password' ? <div className="grid gap-2"><Label htmlFor="ssh-password">密码</Label><Input id="ssh-password" type="password" value={form.sshPassword} onChange={event => update('sshPassword', event.target.value)} placeholder={form.sshUser.trim() === 'root' ? 'root 密码仅供下一次部署使用，不保存' : '普通用户密码默认保存'} required /></div> : <div className="grid gap-2"><Label htmlFor="ssh-key">私钥文件</Label><Input id="ssh-key" type="file" onChange={event => uploadKey(event.target.files?.[0])} required /><span className="text-xs text-muted-foreground">{form.sshPrivateKeyName || (form.sshUser.trim() === 'root' ? 'root 私钥仅供下一次部署使用，不保存' : '普通用户私钥默认保存')}</span></div>}

          {preflight ? <div className="space-y-2 rounded-[20px] border border-[var(--border)] bg-[var(--surface-container)] p-4"><div className="flex items-center justify-between"><p className="font-medium">SSH 预检结果</p><Badge variant={preflight.checks.every(item => item.ok) ? 'secondary' : 'destructive'}>{preflight.checks.every(item => item.ok) ? '全部通过' : '存在阻塞'}</Badge></div>{preflight.checks.map(item => <div key={item.key} className="flex items-center justify-between gap-4 text-sm"><span className="flex items-center gap-2"><Icon icon={item.ok ? 'ph:check-circle-fill' : 'ph:x-circle-fill'} className={item.ok ? 'text-primary' : 'text-destructive'} />{item.label}</span><span className="text-right text-muted-foreground">{item.detail}</span></div>)}<div className="border-t border-[var(--border)] pt-2 text-xs text-muted-foreground">主机指纹：<code className="break-all">{preflight.hostKey}</code></div></div> : null}
        </div>
        <DialogFooter><Button type="button" variant="outline" disabled={Boolean(loading)} onClick={onClose}>取消</Button>{preflight?.checks.every(item => item.ok) ? <Button type="button" disabled={Boolean(loading)} onClick={save}><Icon icon={loading === 'save' ? 'ph:spinner-bold' : 'ph:floppy-disk-light'} className={loading === 'save' ? 'animate-spin' : ''} />确认指纹并保存节点</Button> : <Button type="submit" disabled={Boolean(loading)}><Icon icon={loading === 'preflight' ? 'ph:spinner-bold' : 'ph:shield-check-light'} className={loading === 'preflight' ? 'animate-spin' : ''} />执行 SSH 预检</Button>}</DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
