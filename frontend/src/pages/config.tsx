import type { GetServerSideProps } from 'next'
import { useCallback, useState } from 'react'
import { Icon } from '@iconify/react'
import { toast } from 'sonner'
import { apiService, type ApiStatus } from '@/lib/api'
import type { ClusterStatus, KernelType } from '@/server/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import SignalPage from '@/components/shared/SignalPage'

interface ConfigPageProps {
  initialStatus: ApiStatus | null
  initialCluster: ClusterStatus | null
  initialConfigs: string[]
  frontendConfig: any
  initialError: string | null
}

const kernelLabels: Record<KernelType, string> = {
  'sing-box': 'sing-box',
  xray: 'Xray',
  v2ray: 'V2Ray',
}

export default function ConfigPage({ initialStatus, initialCluster, initialConfigs, frontendConfig, initialError }: ConfigPageProps) {
  const [configsText, setConfigsText] = useState(initialConfigs.join('\n'))
  const [status, setStatus] = useState(initialStatus)
  const [cluster, setCluster] = useState(initialCluster)
  const [error, setError] = useState<string | null>(initialError)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const saveConfigs = useCallback(async () => {
    const configs = configsText.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
    if (configs.length === 0) {
      setError('至少保留一个 sing-box 配置名称')
      return
    }
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const result = await apiService.updateConfigs(configs)
      if (!result.success) throw new Error(result.error || '保存失败')
      setMessage(`已保存 ${result.data?.count || configs.length} 个配置名称`)
      toast.success('配置已保存', { description: `${result.data?.count || configs.length} 个 sing-box 配置` })
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败'
      setError(message)
      toast.error('保存失败', { description: message })
    } finally {
      setSaving(false)
    }
  }, [configsText])

  const refreshStatus = useCallback(async () => {
    const [nextStatus, nextCluster] = await Promise.all([
      apiService.getStatus(),
      apiService.getClusterStatus(),
    ])
    setStatus(nextStatus)
    if (nextCluster.success) setCluster(nextCluster.data as ClusterStatus)
    toast.success('状态已刷新')
  }, [])

  const network = frontendConfig?.network || {}
  const app = frontendConfig?.app || {}
  const protocols = frontendConfig?.protocols || {}
  const childNodes = cluster?.nodes || []
  const kernelCapabilities = (Object.keys(kernelLabels) as KernelType[]).map((kernel) => {
    const nodes = childNodes.filter(node => node.configuredKernels.some(config => config.type === kernel))
    const accessible = nodes.filter(node => {
      const runtime = node.kernels.find(status => status.type === kernel)
      return node.online && runtime?.monitored && runtime.accessible
    }).length
    return {
      label: `${kernelLabels[kernel]} 子节点`,
      ok: nodes.length > 0 && accessible === nodes.length,
      detail: nodes.length > 0 ? `${accessible}/${nodes.length} 可用` : '无子节点',
    }
  })

  return (
    <SignalPage
      crumb="Runtime vault"
      title="配置"
      description="管理常用运行配置；完整 YAML 仍由服务端配置文件负责。"
      status="配置校验通过"
      maxWidth="narrow"
      actions={(
        <Button variant="outline" onClick={refreshStatus}>
          <Icon icon="ph:arrow-clockwise-light" />
          刷新状态
        </Button>
      )}
    >

      {error ? (
        <Alert variant="destructive" className="flex gap-3">
          <Icon icon="ph:warning-circle-bold" className="mt-0.5 h-5 w-5" />
          <div>
            <AlertTitle>配置操作失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
        </Alert>
      ) : null}
      {message ? (
        <Alert variant="success" className="flex gap-3">
          <Icon icon="ph:check-circle-bold" className="mt-0.5 h-5 w-5" />
          <div>
            <AlertTitle>保存成功</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </div>
        </Alert>
      ) : null}

      <div className="grid gap-5 md:grid-cols-3">
        <Card variant="elevated"><CardHeader className="pb-3"><CardDescription>环境</CardDescription><CardTitle className="text-2xl">{app.environment || '-'}</CardTitle></CardHeader></Card>
        <Card variant="elevated"><CardHeader className="pb-3"><CardDescription>Web 端口</CardDescription><CardTitle className="signal-mono text-2xl">{network.nginx_port || '-'}</CardTitle></CardHeader></Card>
        <Card variant="elevated"><CardHeader className="pb-3"><CardDescription>版本</CardDescription><CardTitle className="truncate text-2xl">{status?.version || app.version || '-'}</CardTitle></CardHeader></Card>
      </div>

      <Card className="mt-5">
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-xl">配置工作台</CardTitle>
            <CardDescription>常用配置可在页面调整，完整 YAML 仍由服务端配置文件管理。</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="configs">
            <TabsList>
              <TabsTrigger value="configs">配置列表</TabsTrigger>
              <TabsTrigger value="capabilities">运行能力</TabsTrigger>
            </TabsList>
            <TabsContent value="configs" className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="configs">sing-box 配置名称</Label>
                <Textarea id="configs" value={configsText} onChange={event => setConfigsText(event.target.value)} className="min-h-[300px] font-mono" placeholder="vless-reality&#10;hysteria2&#10;trojan…" />
              </div>
              <Separator />
              <Button onClick={saveConfigs} disabled={saving}>
                <Icon icon={saving ? 'ph:spinner-bold' : 'ph:floppy-disk-bold'} className={saving ? 'animate-spin' : ''} />
                保存配置列表
              </Button>
            </TabsContent>
            <TabsContent value="capabilities" className="grid gap-3 md:grid-cols-2">
              {[
                { label: 'Mihomo 转换', ok: Boolean(status?.mihomoAvailable), detail: status?.mihomoVersion || '未检测到' },
                ...kernelCapabilities,
                { label: 'subscription.txt', ok: Boolean(status?.subscriptionExists), detail: status?.subscriptionExists ? '已生成' : '未生成' },
                { label: 'clash.yaml', ok: Boolean(status?.clashExists), detail: status?.clashExists ? '已生成' : '未生成' },
                { label: 'raw.txt', ok: Boolean(status?.rawExists), detail: status?.rawExists ? '已生成' : '未生成' },
              ].map(({ label, ok, detail }) => (
                <div key={label} className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--surface-container)] p-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{detail}</span>
                  </span>
                  <Badge variant={ok ? 'secondary' : 'destructive'}>{ok ? '可用' : '不可用'}</Badge>
                </div>
              ))}
              <div className="rounded-2xl bg-[var(--surface-container)] p-3 md:col-span-2">
                <p className="text-sm font-medium">默认协议</p>
                <p className="mt-1 break-words font-mono text-xs text-muted-foreground">
                  {(protocols.sing_box_configs || []).join(', ') || '-'}
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </SignalPage>
  )
}

export const getServerSideProps: GetServerSideProps<ConfigPageProps> = async () => {
  try {
    const { mioBridgeCore, nodeAggregation } = await import('@/server/core')
    const { config, getFrontendConfig } = await import('@/server/config')
    const [status, cluster] = await Promise.all([
      mioBridgeCore.getStatus(),
      nodeAggregation.getClusterStatus(),
    ])
    return {
      props: {
        initialStatus: JSON.parse(JSON.stringify(status)),
        initialCluster: JSON.parse(JSON.stringify(cluster)),
        initialConfigs: config.singBoxConfigs,
        frontendConfig: JSON.parse(JSON.stringify(getFrontendConfig())),
        initialError: null,
      },
    }
  } catch (error) {
    return {
      props: {
        initialStatus: null,
        initialCluster: null,
        initialConfigs: [],
        frontendConfig: null,
        initialError: error instanceof Error ? error.message : '读取配置失败',
      },
    }
  }
}
