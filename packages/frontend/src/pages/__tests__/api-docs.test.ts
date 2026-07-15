import { describe, expect, it } from 'vitest'
import { canOpenEndpoint, readOpenApiEndpoints } from '../api-docs'

describe('API 文档契约映射', () => {
  it('只从 OpenAPI paths 生成端点并保留 tag 与响应', () => {
    const endpoints = readOpenApiEndpoints({
      openapi: '3.1.0',
      paths: {
        '/api/nodes': {
          get: { tags: ['Nodes'], summary: '节点列表', responses: { 200: { description: '成功' } } },
          post: { tags: ['Nodes'], summary: '创建节点', responses: { 202: { description: '已接收' } } },
        },
      },
    })

    expect(endpoints).toHaveLength(2)
    expect(endpoints.map(endpoint => `${endpoint.method} ${endpoint.path}`)).toEqual([
      'GET /api/nodes',
      'POST /api/nodes',
    ])
    expect(endpoints[0].tag).toBe('Nodes')
    expect(endpoints[1].operation.responses?.[202]?.description).toBe('已接收')
  })

  it('只有 GET 端点允许在文档页打开', () => {
    expect(canOpenEndpoint({ method: 'GET' })).toBe(true)
    expect(canOpenEndpoint({ method: 'POST' })).toBe(false)
    expect(canOpenEndpoint({ method: 'PATCH' })).toBe(false)
    expect(canOpenEndpoint({ method: 'DELETE' })).toBe(false)
  })
})
