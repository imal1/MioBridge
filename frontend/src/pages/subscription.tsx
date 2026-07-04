"use client";

import { useCallback, useEffect, useState } from 'react'
import { Editor } from '@monaco-editor/react'
import { Icon } from '@iconify/react'
import { toast } from 'sonner'
import { apiService, type ApiStatus, type UpdateResult } from '@/lib/api'
import { useTheme } from '@/components/ThemeProvider'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
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
  const { theme } = useTheme()
  const [status, setStatus] = useState<ApiStatus | null>(null)
  const [inputText, setInputText] = useState('')
  const [outputYaml, setOutputYaml] = useState('')
  const [loading, setLoading] = useState<'convert' | 'update' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null)
  const [copied, setCopied] = useState(false)

  const refreshStatus = useCallback(async () => {
    setStatus(await apiService.getStatus())
  }, [])

  useEffect(() => {
    refreshStatus().catch(() => {})
  }, [refreshStatus])

  const handleConvert = useCallback(async () => {
    if (!inputText.trim()) {
      setError('请输入原始订阅文本')
      return
    }
    setLoading('convert')
    setError(null)
    try {
      const result = await apiService.convertContent(inputText)
      if (result.success && result.data?.clashConfig) {
        setOutputYaml(result.data.clashConfig)
        toast.success('转换完成', { description: `生成 ${result.data.configLength} 字符 YAML` })
      } else {
        const message = result.error || '转换失败，请检查输入内容'
        setError(message)
        toast.error('转换失败', { description: message })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '转换失败，请查看日志'
      setError(message)
      toast.error('转换失败', { description: message })
    } finally {
      setLoading(null)
    }
  }, [inputText])

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

  const handleCopy = useCallback(async () => {
    if (!outputYaml) return
    await navigator.clipboard.writeText(outputYaml)
    setCopied(true)
    toast.success('已复制 YAML')
    setTimeout(() => setCopied(false), 1600)
  }, [outputYaml])

  return (
    <SignalPage
      crumb="Subscription pipeline"
      title="订阅"
      description="管理输出产物，更新主节点订阅，或把原始节点文本转换为 Clash YAML。"
      status={`最近生成 ${formatDate(status?.clashLastUpdated || status?.subscriptionLastUpdated)}`}
      actions={(
        <>
          <Button onClick={handleUpdate} disabled={loading !== null}>
            <Icon icon={loading === 'update' ? 'ph:spinner-light' : 'ph:arrows-clockwise-light'} className={loading === 'update' ? 'animate-spin' : ''} />
            {loading === 'update' ? '更新中' : '更新订阅'}
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

      <section className="relative mt-5 grid gap-5 xl:grid-cols-[0.92fr_56px_1.08fr]">
        <Card className="min-h-[520px]">
          <CardHeader>
            <CardDescription>手动转换</CardDescription>
            <CardTitle className="text-xl">原始订阅文本</CardTitle>
          </CardHeader>
          <CardContent className="flex h-full flex-col gap-4">
            <Textarea
              className="min-h-[320px] flex-1 resize-none rounded-[22px] border-[var(--border)] bg-[var(--surface-container-lowest)] font-mono text-sm"
              value={inputText}
              onChange={event => setInputText(event.target.value)}
              placeholder="粘贴原始节点链接，每行一条..."
            />
            <Button onClick={handleConvert} disabled={loading !== null || !inputText.trim()}>
              <Icon icon={loading === 'convert' ? 'ph:spinner-light' : 'ph:arrows-left-right-light'} className={loading === 'convert' ? 'animate-spin' : ''} />
              {loading === 'convert' ? '转换中' : '转换为 Clash YAML'}
            </Button>
          </CardContent>
        </Card>

        <div className="hidden place-items-center xl:grid">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_24px_70px_rgba(63,143,95,.26)]" style={{ animation: 'pipeline-beat 2200ms var(--motion) infinite' }}>
            <Icon icon="ph:arrow-right-light" className="h-6 w-6" />
          </div>
        </div>

        <Card className="min-h-[580px]">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardDescription>预览</CardDescription>
                <CardTitle className="text-xl">Clash YAML</CardTitle>
              </div>
              <Button variant="outline" size="sm" onClick={handleCopy} disabled={!outputYaml}>
                <Icon icon={copied ? 'ph:check-light' : 'ph:copy-light'} />
                {copied ? '已复制' : '复制'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[440px] overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--surface-container-lowest)] shadow-[var(--shadow-card)] md:h-[500px]">
              <Editor
                height="100%"
                defaultLanguage="yaml"
                value={outputYaml}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  tabSize: 2,
                  automaticLayout: true,
                }}
                theme={theme === 'dark' ? 'vs-dark' : 'vs'}
              />
            </div>
          </CardContent>
        </Card>
      </section>
    </SignalPage>
  )
}
