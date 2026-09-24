import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiService, type NodeDiagnosticsReport } from '@/lib/api'
import { queryKeys } from '@/lib/queries/keys'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const statusLabel = { pass: '通过', warning: '警告', fail: '失败' }
const statusColor = { pass: 'var(--success)', warning: 'var(--warning)', fail: 'var(--danger)' }

export function NodeMaintenancePanel({ nodeId, runtimeUser, serviceMode }: {
  nodeId: string; runtimeUser?: string; serviceMode?: 'user' | 'system'
}) {
  const queryClient = useQueryClient()
  const [report, setReport] = useState<NodeDiagnosticsReport | null>(null)
  const [busy, setBusy] = useState<'diagnose' | 'repair' | 'migrate' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [migrationOpen, setMigrationOpen] = useState(false)
  const [user, setUser] = useState(runtimeUser === 'root' ? '' : runtimeUser ?? '')
  const validUser = user !== 'root' && /^[a-z_][a-z0-9_-]*[$]?$/i.test(user)
  const mode = report?.serviceMode ?? serviceMode

  async function run(action: 'diagnose' | 'repair' | 'migrate') {
    setBusy(action); setError(null); setMessage(null)
    try {
      const response = action === 'diagnose' ? await apiService.diagnoseNode(nodeId)
        : action === 'repair' ? await apiService.repairNode(nodeId)
          : await apiService.migrateNodeService(nodeId, user)
      if (!response.success || !response.data) throw new Error(response.error || '节点维护失败')
      setReport(response.data)
      if (action !== 'diagnose') {
        setMessage(action === 'repair' ? '修复完成，断线存活验收通过' : '迁移完成，断线存活验收通过')
        setMigrationOpen(false)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.clusterStatus }),
          queryClient.invalidateQueries({ queryKey: queryKeys.componentStates() }),
        ])
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : '节点维护失败') }
    finally { setBusy(null) }
  }

  return (
    <section className="mt-4 space-y-3" aria-label="节点体检与修复">
      <div>
        <h3 className="text-sm font-semibold">节点体检与修复</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {mode === 'system' ? '系统级服务' : mode === 'user' ? '用户级服务' : '运行模式待体检'}
          {report?.runtimeUser ? ` · ${report.runtimeUser}` : ''}
          {report ? ` · ${new Date(report.checkedAt).toLocaleString('zh-CN')}` : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run('diagnose')}>{busy === 'diagnose' ? '体检中…' : '开始体检'}</Button>
        <Button size="sm" variant="outline" disabled={busy !== null || !report || report.healthy} onClick={() => run('repair')}>{busy === 'repair' ? '修复与验收中…' : '一键修复'}</Button>
        {mode !== 'system' ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setMigrationOpen(true)}>迁移至系统级服务</Button> : null}
      </div>
      {busy && busy !== 'diagnose' ? <p role="status" className="text-xs text-muted-foreground">正在维护服务；完成后将断开 SSH，等待稳定并独立验证健康状态及版本。</p> : null}
      {error ? <p role="alert" className="text-xs" style={{ color: 'var(--danger)', overflowWrap: 'anywhere' }}>{error}</p> : null}
      {message ? <p role="status" className="text-xs" style={{ color: 'var(--success)' }}>{message}</p> : null}
      {report ? <ul className="space-y-2" aria-label="体检结果">
        {report.checks.map(check => <li key={check.key} className="rounded-lg p-3 text-xs" style={{ background: 'var(--card2)' }}>
          <div className="flex justify-between gap-2"><strong>{check.label}</strong><span style={{ color: statusColor[check.status] }}>{statusLabel[check.status]}</span></div>
          <p className="mt-1 break-words">{check.reason}</p>
          {check.suggestion ? <p className="mt-1 text-muted-foreground">{check.suggestion}</p> : null}
        </li>)}
      </ul> : null}
      <Dialog open={migrationOpen} onOpenChange={open => { if (!busy) setMigrationOpen(open) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>迁移至系统级服务</DialogTitle>
            <DialogDescription>系统级 Agent 随服务器启动，不依赖 Linger。需要 root 或免密 sudo 权限；先验证新服务，再切换端口，失败会恢复原服务。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-3">
            <Label htmlFor={`agent-runtime-user-${nodeId}`}>非特权运行用户</Label>
            <Input id={`agent-runtime-user-${nodeId}`} value={user} disabled={busy !== null} onChange={event => setUser(event.target.value)} placeholder="服务器上已存在的非 root 用户" />
            <p className="text-xs text-muted-foreground">运行用户与 SSH 登录用户可以不同。现有节点仅在点击开始迁移后变更。</p>
            {error ? <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy !== null} onClick={() => setMigrationOpen(false)}>取消</Button>
            <Button disabled={busy !== null || !validUser} onClick={() => run('migrate')}>{busy === 'migrate' ? '迁移与验收中…' : '开始迁移'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
