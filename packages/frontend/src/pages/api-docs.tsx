import { useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { toast } from 'sonner'
import { useOpenApi } from '@/lib/queries'
import PageHeader from '@/components/shared/PageHeader'

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

const METHOD_COLOR: Record<string, string> = { GET: 'var(--primary)', POST: 'var(--info)', PATCH: 'var(--warning)', PUT: 'var(--warning)', DELETE: 'var(--danger)' }

export default function ApiDocsPage() {
  const [open, setOpen] = useState<string | null>(null)
  const openApiQuery = useOpenApi()
  const load = () => { void openApiQuery.refetch() }
  const loading = openApiQuery.isPending

  const raw = openApiQuery.data
  const document = raw && typeof raw === 'object' && 'paths' in raw && (raw as OpenApiDocument).paths ? raw as OpenApiDocument : null
  const error = openApiQuery.error
    ? (openApiQuery.error.message || 'OpenAPI 文档加载失败')
    : (!loading && raw && !document ? '服务端未返回有效的 OpenAPI 文档' : null)

  const endpoints = useMemo(() => document ? readOpenApiEndpoints(document) : [], [document])
  const groups = useMemo(() => {
    const grouped = new Map<string, ApiEndpoint[]>()
    for (const endpoint of endpoints) grouped.set(endpoint.tag, [...(grouped.get(endpoint.tag) ?? []), endpoint])
    return [...grouped.entries()]
  }, [endpoints])
  const serverUrl = document?.servers?.[0]?.url
  const copy = async (value: string, label: string) => { await navigator.clipboard.writeText(value); toast.success(`已复制${label}`) }

  return (
    <>
      <PageHeader
        title="API"
        description={`OpenAPI ${document?.openapi || '3.1'} · ${endpoints.length} 个端点 · v${document?.info?.version || '未知'} · 内容实时来自 /api/openapi.json；写接口仅提供契约与命令复制。`}
        actions={<button onClick={load} disabled={loading} className="mb-pill-btn" style={{ height: 32 }}><Icon icon={loading ? 'ph:spinner-light' : 'ph:arrow-clockwise-light'} className={loading ? 'animate-spin' : ''} />刷新文档</button>}
      />

      {error ? (
        <div className="garden-alert garden-alert-danger" style={{ borderRadius: 12, marginBottom: 12 }}>
          <Icon icon="ph:warning-circle-light" className="mt-0.5 size-5 shrink-0" />
          <div><p className="font-semibold">无法读取 API 契约</p><p className="text-xs">{error}</p></div>
        </div>
      ) : null}

      <div className="flex flex-col gap-[14px]">
        {groups.map(([groupName, groupEndpoints]) => (
          <div key={groupName} className="mb-card overflow-hidden">
            <p style={{ margin: 0, padding: '11px 16px 7px', fontSize: 12.5, fontWeight: 700 }}>{groupName}</p>
            <div>
              {groupEndpoints.map(endpoint => {
                const key = `${endpoint.method}:${endpoint.path}`
                const isOpen = open === key
                return (
                  <div key={key} style={{ borderTop: '1px solid var(--border)' }}>
                    <button
                      onClick={() => setOpen(v => v === key ? null : key)} aria-expanded={isOpen}
                      className="mb-hover"
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 16px', border: 'none', background: 'transparent', color: 'var(--foreground)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
                    >
                      <span className="signal-mono" style={{ display: 'inline-flex', justifyContent: 'center', minWidth: 46, padding: '2px 0', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'var(--card2)', color: METHOD_COLOR[endpoint.method] || 'var(--muted-foreground)' }}>{endpoint.method}</span>
                      <code className="signal-mono" style={{ fontSize: 11.5 }}>{endpoint.path}</code>
                      <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted-foreground)' }} className="hidden md:inline">{endpoint.summary}</span>
                      <Icon icon={isOpen ? 'ph:caret-up-bold' : 'ph:caret-down-bold'} style={{ fontSize: 12, color: 'var(--muted-foreground)' }} />
                    </button>
                    {isOpen ? (
                      <div style={{ padding: '0 16px 12px' }}>
                        {endpoint.description ? <p style={{ margin: '0 0 8px', fontSize: 11.5, color: 'var(--muted-foreground)' }}>{endpoint.description}</p> : null}
                        <pre className="signal-mono" style={{ margin: 0, padding: '10px 12px', borderRadius: 10, background: 'var(--terminal)', color: 'var(--terminal-fg)', fontSize: 11, overflow: 'auto' }}>{curlFor(endpoint, serverUrl)}</pre>
                        <div className="mt-2 flex gap-1.5">
                          <button onClick={() => copy(endpointUrl(endpoint, serverUrl), ' URL')} className="mb-pill-btn" style={{ height: 26, padding: '0 10px', fontSize: 11 }}>复制 URL</button>
                          <button onClick={() => copy(curlFor(endpoint, serverUrl), ' cURL')} className="mb-pill-btn" style={{ height: 26, padding: '0 10px', fontSize: 11 }}>复制 cURL</button>
                          {canOpenEndpoint(endpoint) ? <a href={endpointUrl(endpoint, serverUrl)} target="_blank" rel="noreferrer" className="mb-pill-btn" style={{ height: 26, padding: '0 10px', fontSize: 11 }}>打开 GET</a> : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {!loading && !error && endpoints.length === 0 ? (
          <div className="mb-card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 12 }}>契约中没有可显示的 paths。</div>
        ) : null}
      </div>
    </>
  )
}
