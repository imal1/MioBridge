import { describe, expect, it } from 'vitest'
import { initialLogSource } from '../logs'

describe('日志页来源路由', () => {
  it('显式 source 优先', () => {
    expect(initialLogSource(new URLSearchParams('source=subscription&task=job-1'))).toBe('subscription')
  })

  it('旧任务链接映射到部署任务日志', () => {
    expect(initialLogSource(new URLSearchParams('task=deploy-1'))).toBe('deployment')
  })

  it('节点链接映射到 Agent，默认进入控制面', () => {
    expect(initialLogSource(new URLSearchParams('node=node-1'))).toBe('agent')
    expect(initialLogSource(new URLSearchParams())).toBe('control')
  })
})
