// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryBoundary } from '../QueryBoundary'

const base = { data: undefined, isPending: false, isError: false, error: null, refetch: vi.fn() } as const

describe('QueryBoundary', () => {
  it('renders skeleton while first load pending', () => {
    render(<QueryBoundary query={{ ...base, isPending: true }} skeleton={<div>SKELE</div>}>{() => <div>DATA</div>}</QueryBoundary>)
    expect(screen.getByText('SKELE')).toBeDefined()
  })

  it('renders error card with retry that calls refetch', () => {
    const refetch = vi.fn()
    render(<QueryBoundary query={{ ...base, isError: true, error: new Error('boom'), refetch }}>{() => <div>DATA</div>}</QueryBoundary>)
    expect(screen.getByText('boom')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('renders empty state when isEmpty true', () => {
    render(<QueryBoundary query={{ ...base, data: [] }} isEmpty={(d: unknown[]) => d.length === 0} empty={<div>EMPTY</div>}>{() => <div>DATA</div>}</QueryBoundary>)
    expect(screen.getByText('EMPTY')).toBeDefined()
  })

  it('renders children on success with data', () => {
    render(<QueryBoundary query={{ ...base, data: [1] }}>{(d: number[]) => <div>rows:{d.length}</div>}</QueryBoundary>)
    expect(screen.getByText('rows:1')).toBeDefined()
  })
})
