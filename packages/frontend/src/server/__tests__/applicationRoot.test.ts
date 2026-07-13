import { describe, expect, it } from 'vitest'
import { resolveApplicationRoot } from '../applicationRoot'

describe('resolveApplicationRoot', () => {
  it('derives repository and standalone roots from the frontend package', () => {
    expect(resolveApplicationRoot(() => '/opt/miobridge/frontend/package.json')).toBe('/opt/miobridge')
    expect(resolveApplicationRoot(() => '/srv/dist/frontend/package.json')).toBe('/srv/dist')
  })
})
