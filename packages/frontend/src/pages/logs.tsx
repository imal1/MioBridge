import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { toast } from 'sonner'
import { apiService, type LogsResult } from '@/lib/api'
import type { ClusterStatus, NodeStatus } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Select } from '@/components/ui/select'
import SignalPage from '@/components/shared/SignalPage'

const LEVELS = [
  { value: 'all', label: '全部级别' },
  { value: 'error', label: 'ERROR' },
  { value: 'warn', label: 'WARN' },
  { value: 'info', label: 'INFO' },
  { value: 'debug', label: 'DEBUG' },
]

export default function LogsPage() {
  const [logs, setLogs] = useState<LogsResult | null>(null)
  const [nodes, setNodes] = useState<NodeStatus[]>([])
  const [nodeId, setNodeId] = useState('')
  const [file, setFile] = useState('')
  const [level, setLevel] = useState('all')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadLogs = useCallback(async () => {
    if (!nodeId) {
      setLogs(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await apiService.getLogs(nodeId, file, level, query)
      if (!result.success || !result.data) throw new Error(result.error || '读取日志失败')
      setLogs(result.data)
      if (!file) setFile(result.data.file)
      toast.success('日志已刷新', { description: `${result.data.nodeName || nodeId} · ${result.data.file} · ${result.data.lines.length} 行` })
    } catch (err) {
      const message = err instanceof Error ? err.message : '读取日志失败'
      setError(message)
      toast.error('读取日志失败', { description: message })
    } finally {
      setLoading(false)
    }
  }, [file, level, nodeId, query])

  useEffect(() => {
    apiService.getClusterStatus()
      .then(result => {
        if (!result.success) return
        const cluster = result.data as ClusterStatus
        const availableNodes = (cluster.nodes || []).filter(node => node.agent?.deployed)
        setNodes(availableNodes)
        if (!nodeId && availableNodes[0]) setNodeId(availableNodes[0].nodeId)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadLogs().catch(() => {})
  }, [loadLogs])

  return (
    <SignalPage
      crumb="Diagnostics stream"
      title="日志"
      description="选择已部署 Agent 的节点查看运行日志，过滤部署、转换和健康检查错误。"
      status={logs ? `${logs.nodeName || logs.nodeId} · ${logs.file} · ${logs.lines.length} 行` : nodes.length ? '选择节点' : '暂无可用节点'}
      maxWidth="narrow"
      actions={(
        <Button variant="outline" onClick={loadLogs} disabled={loading}>
          <Icon icon={loading ? 'ph:spinner-light' : 'ph:arrow-clockwise-light'} className={loading ? 'animate-spin' : ''} />
          刷新日志
        </Button>
      )}
    >

      {error ? (
        <Alert variant="destructive" className="flex gap-3">
          <Icon icon="ph:warning-circle-bold" className="mt-0.5 h-5 w-5" />
          <div>
            <AlertTitle>日志读取失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
        </Alert>
      ) : null}

      <Card className="min-h-0 md:min-h-[72vh]">
        {nodes.length === 0 ? (
          <CardContent className="p-10 text-center text-muted-foreground">
            暂无节点日志。请先为节点部署 Agent。
          </CardContent>
        ) : null}
        {nodes.length > 0 ? (
        <>
        <div className="md:hidden">
          <CardHeader>
            <CardTitle className="text-xl">过滤日志</CardTitle>
            <CardDescription>从选中节点的 Agent 读取日志。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="log-node-mobile">节点</Label>
              <Select id="log-node-mobile" value={nodeId} onChange={event => { setNodeId(event.target.value); setFile('') }}>
                {nodes.map(node => <option key={node.nodeId} value={node.nodeId}>{node.name} · {node.location || node.nodeId}</option>)}
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="log-file-mobile">日志文件</Label>
              <Select id="log-file-mobile" value={file} onChange={event => setFile(event.target.value)}>
                {(logs?.files || ['combined.log', 'error.log']).map(item => <option key={item} value={item}>{item}</option>)}
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="log-level-mobile">级别</Label>
              <Select id="log-level-mobile" value={level} onChange={event => setLevel(event.target.value)}>
                {LEVELS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="log-query-mobile">关键词</Label>
              <Input id="log-query-mobile" value={query} onChange={event => setQuery(event.target.value)} placeholder="节点名、错误关键词或接口路径…" autoComplete="off" />
            </div>
            <Button className="w-full" onClick={loadLogs} disabled={loading}>应用过滤</Button>
          </CardContent>
          <div className="border-t border-[var(--border)]">
            <CardHeader>
              <CardTitle className="text-xl">日志流</CardTitle>
              <CardDescription>{logs ? `${logs.nodeName || logs.nodeId} · ${logs.file} · ${logs.lines.length} 行 · ${new Date(logs.updatedAt).toLocaleString('zh-CN')}` : '等待加载'}</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="signal-terminal max-h-[58vh] overflow-auto p-4 font-mono text-[11px] leading-5">
                {logs?.lines.length ? logs.lines.join('\n') : '暂无日志内容'}
              </pre>
            </CardContent>
          </div>
        </div>

        <div className="hidden md:block">
          <ResizablePanelGroup direction="horizontal" className="min-h-0 rounded-[24px] md:min-h-[72vh]">
            <ResizablePanel defaultSize={28} minSize={22}>
              <CardHeader>
                <CardTitle className="text-xl">过滤日志</CardTitle>
                <CardDescription>从选中节点的 Agent 读取日志。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="log-node">节点</Label>
                  <Select id="log-node" value={nodeId} onChange={event => { setNodeId(event.target.value); setFile('') }}>
                    {nodes.map(node => <option key={node.nodeId} value={node.nodeId}>{node.name} · {node.location || node.nodeId}</option>)}
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="log-file">日志文件</Label>
                  <Select id="log-file" value={file} onChange={event => setFile(event.target.value)}>
                    {(logs?.files || ['combined.log', 'error.log']).map(item => <option key={item} value={item}>{item}</option>)}
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="log-level">级别</Label>
                  <Select id="log-level" value={level} onChange={event => setLevel(event.target.value)}>
                    {LEVELS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="log-query">关键词</Label>
                  <Input id="log-query" value={query} onChange={event => setQuery(event.target.value)} placeholder="节点名、错误关键词或接口路径…" autoComplete="off" />
                </div>
                <Button className="w-full" onClick={loadLogs} disabled={loading}>应用过滤</Button>
              </CardContent>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={72} minSize={44}>
              <CardHeader>
                <CardTitle className="text-xl">日志流</CardTitle>
                <CardDescription>{logs ? `${logs.nodeName || logs.nodeId} · ${logs.file} · ${logs.lines.length} 行 · ${new Date(logs.updatedAt).toLocaleString('zh-CN')}` : '等待加载'}</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="signal-terminal max-h-[58vh] overflow-auto p-5 font-mono text-xs leading-6 md:max-h-[60vh]">
                  {logs?.lines.length ? logs.lines.join('\n') : '暂无日志内容'}
                </pre>
              </CardContent>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        </>
        ) : null}
      </Card>
    </SignalPage>
  )
}
