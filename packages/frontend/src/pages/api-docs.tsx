import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { toast } from 'sonner'
import { apiService } from '@/lib/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import MethodBadge from '@/components/shared/MethodBadge'
import SignalPage from '@/components/shared/SignalPage'
import WorkflowRail from '@/components/shared/WorkflowRail'

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

type OpenApiOperation = {
  tags?: string[]
  summary?: string
  description?: string
  parameters?: Array<{ name?: string; in?: string; required?: boolean; description?: string }>
  requestBody?: { required?: boolean; description?: string; content?: Record<string, unknown> }
  responses?: Record<string, { description?: string }>
}

type OpenApiDocument = {
  openapi?: string
  info?: { title?: string; version?: string; description?: string }
  servers?: Array<{ url?: string }>
  paths?: Record<string, Partial<Record<(typeof HTTP_METHODS)[number], OpenApiOperation>>>
}

export type ApiEndpoint = {
  method: string
  path: string
  tag: string
  summary: string
  description?: string
  operation: OpenApiOperation
}

export function readOpenApiEndpoints(document: OpenApiDocument): ApiEndpoint[] {
  return Object.entries(document.paths ?? {}).flatMap(([path, pathItem]) =>
    HTTP_METHODS.flatMap(method => {
      const operation = pathItem?.[method]
      if (!operation) return []
      return [{
        method: method.toUpperCase(),
        path,
        tag: operation.tags?.[0] || 'Other',
        summary: operation.summary || operation.description || '未提供摘要',
        ...(operation.description ? { description: operation.description } : {}),
        operation,
      }]
    }),
  )
}

export function canOpenEndpoint(endpoint: Pick<ApiEndpoint, 'method'>): boolean {
  return endpoint.method === 'GET'
}

function endpointUrl(endpoint: ApiEndpoint, serverUrl?: string) {
  const base = serverUrl || window.location.origin
  return new URL(endpoint.path, base.endsWith('/') ? base : `${base}/`).toString()
}

function curlFor(endpoint: ApiEndpoint, serverUrl?: string) {
  const url = endpointUrl(endpoint, serverUrl)
  if (endpoint.method === 'GET') return `curl -fsS '${url}'`
  const hasJson = Boolean(endpoint.operation.requestBody?.content?.['application/json'])
  return `curl -fsS -X ${endpoint.method}${hasJson ? " -H 'Content-Type: application/json' --data '<request-body>'" : ''} '${url}'`
}

export default function ApiDocsPage() {
  const [document, setDocument] = useState<OpenApiDocument | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiService.getOpenApi() as OpenApiDocument | { success?: boolean; error?: string }
      if (!result || typeof result !== 'object' || !('paths' in result) || !result.paths) {
        throw new Error('服务端未返回有效的 OpenAPI 文档')
      }
      setDocument(result as OpenApiDocument)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'OpenAPI 文档加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const endpoints = useMemo(() => document ? readOpenApiEndpoints(document) : [], [document])
  const groups = useMemo(() => {
    const grouped = new Map<string, ApiEndpoint[]>()
    for (const endpoint of endpoints) grouped.set(endpoint.tag, [...(grouped.get(endpoint.tag) ?? []), endpoint])
    return [...grouped.entries()]
  }, [endpoints])
  const serverUrl = document?.servers?.[0]?.url
  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value)
    toast.success(`已复制${label}`)
  }

  return <SignalPage
    crumb="OpenAPI 3.1"
    title="API"
    description="内容实时来自 /api/openapi.json；写接口仅提供契约与命令复制，不在浏览器内执行。"
    status={loading ? '加载契约中' : error ? '契约不可用' : `${endpoints.length} 个端点 · v${document?.info?.version || '未知'}`}
    maxWidth="narrow"
    actions={<Button variant="outline" onClick={load} disabled={loading}><Icon icon={loading ? 'ph:spinner-light' : 'ph:arrow-clockwise-light'} className={loading ? 'animate-spin' : ''} />刷新文档</Button>}
  >
    <WorkflowRail current="api" />

    {error ? <Alert variant="destructive"><Icon icon="ph:warning-circle-bold" className="h-5 w-5" /><div><AlertTitle>无法读取 API 契约</AlertTitle><AlertDescription>{error}</AlertDescription></div></Alert> : null}

    {!error && document ? <Card><CardHeader><CardTitle>{document.info?.title || 'MioBridge API'}</CardTitle><CardDescription>{document.info?.description || `OpenAPI ${document.openapi || '3.x'} · 服务地址 ${serverUrl || window.location.origin}`}</CardDescription></CardHeader></Card> : null}

    <div className="space-y-5">
      {groups.map(([groupName, groupEndpoints]) => <Card key={groupName}>
        <CardHeader><CardTitle>{groupName}</CardTitle><CardDescription>{groupEndpoints.length} 个契约端点。展开查看参数、响应和复制命令。</CardDescription></CardHeader>
        <CardContent className="space-y-2">{groupEndpoints.map(endpoint => {
          const key = `${endpoint.method}:${endpoint.path}`
          const parameters = endpoint.operation.parameters ?? []
          return <div key={key} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-container)]">
            <button type="button" className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setOpen(value => value === key ? null : key)} aria-expanded={open === key}>
              <MethodBadge method={endpoint.method} />
              <code className="min-w-0 flex-1 break-all text-xs">{endpoint.path}</code>
              <span className="hidden text-sm text-muted-foreground md:block">{endpoint.summary}</span>
              <Icon icon={open === key ? 'ph:caret-up-light' : 'ph:caret-down-light'} />
            </button>
            {open === key ? <div className="space-y-3 border-t border-[var(--border)] p-4">
              <div><p className="text-sm font-medium">{endpoint.summary}</p>{endpoint.description ? <p className="mt-1 text-sm text-muted-foreground">{endpoint.description}</p> : null}</div>
              {parameters.length ? <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-xs"><thead className="text-muted-foreground"><tr><th className="pb-2">参数</th><th className="pb-2">位置</th><th className="pb-2">必填</th><th className="pb-2">说明</th></tr></thead><tbody>{parameters.map((parameter, index) => <tr key={`${parameter.in}:${parameter.name}:${index}`} className="border-t border-[var(--border)]"><td className="py-2 font-mono">{parameter.name || '—'}</td><td>{parameter.in || '—'}</td><td>{parameter.required ? '是' : '否'}</td><td>{parameter.description || '—'}</td></tr>)}</tbody></table></div> : null}
              {endpoint.operation.requestBody ? <div className="rounded-xl bg-[var(--surface-container-lowest)] p-3 text-xs"><p className="font-medium">请求体{endpoint.operation.requestBody.required ? '（必填）' : ''}</p><p className="mt-1 text-muted-foreground">{endpoint.operation.requestBody.description || Object.keys(endpoint.operation.requestBody.content ?? {}).join('、') || '请按 OpenAPI schema 提交。'}</p></div> : null}
              <pre className="overflow-auto rounded-xl bg-[var(--surface-container-lowest)] p-3 text-xs">{curlFor(endpoint, serverUrl)}</pre>
              <p className="text-xs text-muted-foreground">响应：{Object.entries(endpoint.operation.responses ?? {}).map(([status, response]) => `${status} ${response.description || ''}`.trim()).join(' · ') || '未声明'}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => copy(endpointUrl(endpoint, serverUrl), ' URL')}>复制 URL</Button>
                <Button size="sm" variant="outline" onClick={() => copy(curlFor(endpoint, serverUrl), ' cURL')}>复制 cURL</Button>
                {canOpenEndpoint(endpoint) ? <Button asChild size="sm" variant="outline"><a href={endpointUrl(endpoint, serverUrl)} target="_blank" rel="noreferrer">打开 GET</a></Button> : null}
              </div>
            </div> : null}
          </div>
        })}</CardContent>
      </Card>)}
      {!loading && !error && endpoints.length === 0 ? <Card><CardContent className="p-10 text-center text-muted-foreground">契约中没有可显示的 paths。</CardContent></Card> : null}
    </div>
  </SignalPage>
}
