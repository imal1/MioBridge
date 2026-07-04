import { useCallback, useState } from 'react'
import { Icon } from '@iconify/react'
import { apiService } from '@/lib/api'
import { Button } from '@/components/ui/button'
import MethodBadge from '@/components/shared/MethodBadge'
import SignalPage from '@/components/shared/SignalPage'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const ENDPOINTS = [
  { method: 'GET',  path: '/api/status',        desc: '获取服务状态',     action: 'test',     actionLabel: '测试' },
  { method: 'GET',  path: '/api/update',         desc: '触发订阅更新',    action: 'open',     actionLabel: '执行' },
  { method: 'GET',  path: '/subscription.txt',   desc: '下载订阅文件',    action: 'download', actionLabel: '下载' },
  { method: 'GET',  path: '/clash.yaml',         desc: '下载 Clash 配置', action: 'download', actionLabel: '下载' },
  { method: 'GET',  path: '/raw.txt',            desc: '下载原始链接',    action: 'download', actionLabel: '下载' },
  { method: 'GET',  path: '/health',             desc: '健康检查',        action: 'open',     actionLabel: '测试' },
]

export default function ApiDocsPage() {
  const [updating, setUpdating] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleAction = useCallback(async (endpoint: typeof ENDPOINTS[0]) => {
    if (endpoint.action === 'download') {
      window.open(apiService.getDownloadUrl(endpoint.path.replace('/', '')), '_blank')
    } else if (endpoint.action === 'open') {
      if (endpoint.path === '/api/update') {
        setUpdating(true)
        setResult(null)
        try {
          const r = await apiService.updateSubscription()
          setResult(r.success ? `✓ 更新完成 · ${r.nodesCount} 个节点` : `✗ ${r.message}`)
        } catch (err) {
          setResult(`✗ ${err instanceof Error ? err.message : '失败'}`)
        } finally {
          setUpdating(false)
        }
      } else {
        window.open(endpoint.path, '_blank')
      }
    } else {
      window.open(endpoint.path, '_blank')
    }
  }, [])

  return (
    <SignalPage
      crumb="Endpoint ledger"
      title="API 接口"
      description="全部可用接口与快速操作。"
      status="公共兼容路径可用"
      maxWidth="narrow"
    >
      {result && (
        <div className={`garden-alert ${result.startsWith('✓') ? 'garden-alert-success' : 'garden-alert-danger'}`}>
          <Icon icon={result.startsWith('✓') ? 'ph:check-circle-bold' : 'ph:x-circle-bold'} className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p className="text-sm">{result}</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardDescription>Endpoint ledger</CardDescription>
          <CardTitle className="text-xl">接口列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="signal-table min-w-[640px]">
              <thead>
                <tr>
                  <th>方法</th>
                  <th>端点</th>
                  <th>描述</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINTS.map(ep => (
                  <tr key={ep.path}>
                    <td><MethodBadge method={ep.method} /></td>
                    <td>
                      <code className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>
                        {ep.path}
                      </code>
                    </td>
                    <td style={{ color: 'var(--muted-foreground)' }}>{ep.desc}</td>
                    <td className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg text-xs"
                        disabled={updating && ep.path === '/api/update'}
                        onClick={() => handleAction(ep)}
                      >
                        {updating && ep.path === '/api/update'
                          ? <Icon icon="ph:spinner" className="h-3 w-3 animate-spin" />
                          : ep.actionLabel
                        }
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <CardDescription>兼容说明</CardDescription>
          <CardTitle className="text-xl">说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            <Icon icon="ph:arrow-right-light" className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              所有端点通过 nginx 反代，与当前域名同源，无需跨域配置。
            </p>
          </div>
          <div className="flex items-start gap-3">
            <Icon icon="ph:arrow-right-light" className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              订阅文件可直接用作代理客户端的订阅地址（如 Clash、Surge 等）。
            </p>
          </div>
          <div className="flex items-start gap-3">
            <Icon icon="ph:arrow-right-light" className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              <code className="text-xs px-1 py-0.5 rounded" style={{ fontFamily: 'var(--font-mono)', background: 'var(--muted)' }}>/api/update</code>{' '}
              执行时间较长（30s+），页面将等待完成后返回结果。
            </p>
          </div>
        </CardContent>
      </Card>
    </SignalPage>
  )
}
