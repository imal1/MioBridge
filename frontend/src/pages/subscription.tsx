"use client";

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { toast } from 'sonner'
import { apiService, type ApiStatus, type UpdateResult } from '@/lib/api'
import { useAppContext } from '@/context/AppContext'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import SignalPage from '@/components/shared/SignalPage'

const ARTIFACTS = [
  { name: 'raw.txt', label: '原始链接', key: 'rawExists', desc: '聚合后的纯净节点 URL' },
  { name: 'subscription.txt', label: '订阅文件', key: 'subscriptionExists', desc: 'Base64 通用订阅输出' },
  { name: 'clash.yaml', label: 'Clash 配置', key: 'clashExists', desc: 'mihomo 转换后的 YAML' },
] as const

function formatDate(value?: string) {
  if (!value) return '尚未生成'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export default function SubscriptionPage() {
  const { openConvertModal } = useAppContext()
  const [status, setStatus] = useState<ApiStatus | null>(null)
  const [loading, setLoading] = useState<'update' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null)

  const refreshStatus = useCallback(async () => {
    setStatus(await apiService.getStatus())
  }, [])

  useEffect(() => {
    refreshStatus().catch(() => {})
  }, [refreshStatus])

  const handleUpdate = useCallback(async () => {
    setLoading('update')
    setError(null)
    setUpdateResult(null)
    try {
      const result = await apiService.updateSubscription()
      setUpdateResult(result)
      await refreshStatus()
      if (result.success) toast.success('订阅更新完成', { description: `生成 ${result.nodesCount} 个节点` })
      else toast.error('订阅更新失败', { description: result.message })
    } catch (err) {
      const message = err instanceof Error ? err.message : '更新失败，请查看日志'
      setError(message)
      toast.error('更新失败', { description: message })
    } finally {
      setLoading(null)
    }
  }, [refreshStatus])

  return (
    <SignalPage
      crumb="Subscription pipeline"
      title="订阅"
      description="自动聚合子节点来源并生成 raw.txt、subscription.txt 和 clash.yaml。"
      status={`最近生成 ${formatDate(status?.clashLastUpdated || status?.subscriptionLastUpdated)}`}
      maxWidth="narrow"
      actions={(
        <>
          <Button onClick={handleUpdate} disabled={loading !== null}>
            <Icon icon={loading === 'update' ? 'ph:spinner-light' : 'ph:arrows-clockwise-light'} className={loading === 'update' ? 'animate-spin' : ''} />
            {loading === 'update' ? '更新中' : '更新订阅'}
          </Button>
          <Button variant="outline" onClick={openConvertModal}>
            <Icon icon="ph:arrows-left-right-light" />
            手动转换
          </Button>
          <Button variant="outline" onClick={refreshStatus}>刷新状态</Button>
        </>
      )}
    >
      {error ? (
        <Alert variant="destructive" className="mb-6 flex gap-3">
          <Icon icon="ph:warning-circle-light" className="mt-0.5 h-5 w-5" />
          <div><AlertTitle>操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></div>
        </Alert>
      ) : null}

      {updateResult ? (
        <Alert variant={updateResult.success ? 'success' : 'destructive'} className="mb-6">
          <AlertTitle>{updateResult.success ? '更新完成' : '更新失败'}</AlertTitle>
          <AlertDescription>{updateResult.message}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-3">
        {ARTIFACTS.map(artifact => {
          const available = Boolean(status?.[artifact.key])
          return (
            <Card key={artifact.name}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardDescription>{artifact.desc}</CardDescription>
                    <CardTitle className="mt-2 text-2xl">{artifact.label}</CardTitle>
                  </div>
                  <Badge variant={available ? 'secondary' : 'destructive'}>{available ? '可用' : '缺失'}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-[20px] bg-[var(--surface-container)] p-4">
                  <p className="signal-mono text-sm">{artifact.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">节点 {status?.nodesCount ?? 0} · {formatDate(artifact.name === 'clash.yaml' ? status?.clashLastUpdated : status?.subscriptionLastUpdated)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline"><a href={apiService.getDownloadUrl(artifact.name)} target="_blank" rel="noreferrer">下载</a></Button>
                  <Button asChild size="sm" variant="outline"><a href={`/${artifact.name}`} target="_blank" rel="noreferrer">打开</a></Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </section>

      <section className="mt-5">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <CardDescription>规则工作台</CardDescription>
                <CardTitle className="text-xl">Clash 规则配置</CardTitle>
              </div>
              <Badge variant="secondary">预留</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[1.2fr_.8fr]">
            <div className="rounded-[20px] border border-dashed border-[var(--border)] bg-[var(--surface-container-lowest)] p-5">
              <p className="text-sm leading-6 text-muted-foreground">
                这里先留给后续的 Clash 规则配置。自动订阅更新仍然是当前页面的主流程，临时粘贴文本转换已经收纳到右上角按钮。
              </p>
            </div>
            <div className="rounded-[20px] bg-[var(--surface-container)] p-5">
              <p className="signal-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">Next slot</p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                规则集、策略组和覆写项会在这里展开，不占用现有产物状态区。
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    </SignalPage>
  )
}
