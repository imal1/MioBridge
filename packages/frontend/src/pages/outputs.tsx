import { useState } from 'react'
import { Icon } from '@iconify/react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { apiService } from '@/lib/api'
import { useArtifacts, useValidateArtifacts } from '@/lib/queries'
import type { ArtifactState } from '@/lib/types'
import { useAppContext } from '@/context/AppContext'
import { QueryBoundary } from '@/components/shared/QueryBoundary'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import SignalPage from '@/components/shared/SignalPage'

const META: Record<ArtifactState['name'], { label: string; description: string; contentType: string }> = {
  'raw.txt': { label: '原始链接', description: '聚合、清洗并去重后的节点 URL', contentType: 'text/plain' },
  'subscription.txt': { label: 'Base64 订阅', description: '经编码验证的通用客户端订阅', contentType: 'text/plain' },
  'clash.yaml': { label: 'Clash 配置', description: '经 mihomo 转换和验证的 YAML', contentType: 'application/yaml' },
}

function freshnessLabel(value: ArtifactState['freshness']) {
  return value === 'fresh' ? '新鲜' : value === 'expiring' ? '即将过期' : value === 'stale' ? '已过期' : '无效'
}

export default function OutputsPage() {
  const { openConvertModal } = useAppContext()
  const artifactsQuery = useArtifacts()
  const artifacts = artifactsQuery.data ?? []
  const validateArtifacts = useValidateArtifacts()
  const [preview, setPreview] = useState<{ name: string; content: string; truncated: boolean } | null>(null)
  const [checking, setChecking] = useState(false)

  const copyUrl = async (name: string) => {
    const url = new URL(`/${name}`, window.location.origin).toString()
    await navigator.clipboard.writeText(url)
    toast.success('已复制公共产物 URL', { description: url })
  }

  const openPreview = async (name: ArtifactState['name']) => {
    const response = await apiService.previewArtifact(name)
    if (response.success && response.data) setPreview(response.data)
    else toast.error('产物预览失败')
  }

  const validate = async () => {
    setChecking(true)
    try {
      // mutation 成功后失效 artifacts 查询，列表自动刷新；这里只用返回值算未通过数量。
      const response = await validateArtifacts.mutateAsync(undefined)
      const invalid = response.data?.artifacts.filter(item => !item.valid).length || 0
      if (invalid > 0) toast.warning(`${invalid} 个产物未通过验证`)
      else toast.success('三个正式产物均通过验证')
    } finally { setChecking(false) }
  }

  return (
    <SignalPage crumb="Derived artifacts" title="衍生输出" description="负责正式产物的状态、预览、验证、URL、打开和下载；临时转换不会覆盖正式文件。" status={`${artifacts.filter(item => item.valid).length}/3 个产物有效`} maxWidth="narrow" actions={<><Button variant="outline" onClick={validate} disabled={checking}><Icon icon={checking ? 'ph:spinner-bold' : 'ph:shield-check-light'} className={checking ? 'animate-spin' : ''} />验证全部</Button><Button variant="outline" onClick={openConvertModal}><Icon icon="ph:arrows-left-right-light" />临时转换</Button></>}>
      <QueryBoundary
        query={artifactsQuery}
        skeleton={<div className="grid gap-5 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-xl" />)}</div>}
        isEmpty={(data: ArtifactState[]) => data.length === 0}
        empty={<Card><CardContent className="p-8 text-center text-muted-foreground">产物状态尚未加载。</CardContent></Card>}
      >
      {() => <div className="grid gap-5 xl:grid-cols-3">
        {artifacts.map(item => {
          const meta = META[item.name]
          return <Card key={item.name}><CardHeader><div className="flex items-start justify-between gap-3"><div><CardDescription>{meta.description}</CardDescription><CardTitle className="mt-2">{meta.label}</CardTitle></div><Badge variant={item.valid ? 'secondary' : 'destructive'}>{item.valid ? freshnessLabel(item.freshness) : '无效/缺失'}</Badge></div></CardHeader><CardContent className="space-y-4"><div className="rounded-2xl bg-[var(--surface-container)] p-4"><code>{item.name}</code><p className="mt-2 text-xs text-muted-foreground">{meta.contentType} · {item.size} bytes</p><p className="mt-1 text-xs text-muted-foreground">{item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN') : '尚未生成'}{item.ageSeconds !== undefined ? ` · ${Math.floor(item.ageSeconds / 60)} 分钟前` : ''}</p>{item.validationError ? <p className="mt-2 text-xs text-destructive">{item.validationError}</p> : null}</div>{item.exists ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => copyUrl(item.name)}>复制 URL</Button><Button size="sm" variant="outline" onClick={() => openPreview(item.name)}>站内预览</Button><Button asChild size="sm" variant="outline"><a href={`/${item.name}`} target="_blank" rel="noreferrer">打开</a></Button><Button asChild size="sm"><a href={apiService.getDownloadUrl(item.name)} download>下载</a></Button></div> : <Button asChild size="sm"><Link to="/subscription">前往订阅生成</Link></Button>}</CardContent></Card>
        })}
      </div>}
      </QueryBoundary>
      <Card className="mt-5"><CardHeader><CardTitle>临时手动转换</CardTitle><CardDescription>粘贴外部内容并临时生成 Clash YAML，不修改 raw.txt、subscription.txt、clash.yaml 或任务历史。</CardDescription></CardHeader><CardContent><Button onClick={openConvertModal}>打开临时转换器</Button></CardContent></Card>
      <Dialog open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(null) }}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>{preview?.name} 预览</DialogTitle><DialogDescription>{preview?.truncated ? '内容较长，当前只显示前 64 KiB。' : '当前正式发布内容。'}</DialogDescription></DialogHeader><pre className="max-h-[65vh] overflow-auto rounded-2xl bg-[var(--surface-container-high)] p-4 text-xs leading-6">{preview?.content}</pre></DialogContent></Dialog>
    </SignalPage>
  )
}
