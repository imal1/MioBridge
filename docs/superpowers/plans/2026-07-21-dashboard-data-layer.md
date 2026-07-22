# Dashboard Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's per-page hand-rolled `useEffect` fetching with a shared TanStack Query data layer that dedupes requests, standardizes loading/error/empty states, and pauses polling on hidden tabs.

**Architecture:** Introduce `@tanstack/react-query` with one `QueryClient` mounted at the app root. All reads move to per-endpoint `useQuery` hooks under `src/lib/queries/`; writes move to `useMutation` with `invalidateQueries`. A single `<QueryBoundary>` renders skeleton / inline-error-card / empty / content. Shared query keys let always-mounted `Sidebar` and the active page collapse into one request.

**Tech Stack:** React 19, TanStack Query v5, ky, sonner, vitest + @testing-library/react, Tailwind.

## Global Constraints

- Frontend-only. No backend/API contract changes.
- `apiService` (`src/lib/api.ts`) stays the single HTTP surface — query hooks wrap its methods, they do not call `ky` directly.
- Preserve all existing Chinese UI copy and sonner success/failure toasts on writes.
- `ky` GET retry limit drops to `0`; React Query owns retries (`retry: 1`).
- Polling cadence unchanged: deploy 4s, subscription 5s, logs 5s. All polling uses `refetchIntervalInBackground: false`.
- Tests run with `bun run test` (`vitest run --maxWorkers=1 --no-file-parallelism`) from `packages/frontend`.
- Every test that renders a component using a query hook MUST wrap it in a `QueryClientProvider` via the shared `renderWithClient` helper (Task 4).

---

### Task 1: Add dependency + QueryClient + provider wiring + ky retry

**Files:**
- Modify: `packages/frontend/package.json` (dependencies)
- Create: `packages/frontend/src/lib/queryClient.ts`
- Modify: `packages/frontend/src/App.tsx`
- Modify: `packages/frontend/src/lib/api.ts:77-81` (ky retry limit)

**Interfaces:**
- Produces: `queryClient` (a configured `QueryClient`) and `makeQueryClient()` from `src/lib/queryClient.ts`.

- [ ] **Step 1: Add dependency**

```bash
cd packages/frontend && bun add @tanstack/react-query@^5
```

- [ ] **Step 2: Create the QueryClient factory**

`src/lib/queryClient.ts`:

```ts
import { QueryClient, QueryCache } from '@tanstack/react-query'
import { toast } from 'sonner'

// Background-refresh failures (query already has cached data on screen) get a
// toast. First-load failures render an inline error card via <QueryBoundary>,
// so they must NOT also toast here.
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.state.data === undefined) return
        const message = error instanceof Error ? error.message : '后台刷新失败'
        toast.error('数据刷新失败', { description: message })
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 300_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  })
}

export const queryClient = makeQueryClient()
```

- [ ] **Step 3: Lower ky GET retry in `src/lib/api.ts`**

Change the `retry` block (currently `limit: 3`) so React Query owns retries:

```ts
  retry: {
    limit: 0,
    methods: [...API_RETRY_METHODS],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
  },
```

- [ ] **Step 4: Wrap the app in `src/App.tsx`**

Add import and wrap `AppProvider`'s subtree. Inside `App()`:

```tsx
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
// ...
export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AppProvider>
          <AnimatedRoutes />
          <Toaster richColors position="top-center" />
        </AppProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
```

- [ ] **Step 5: Typecheck + build**

Run: `cd packages/frontend && bun run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/package.json packages/frontend/bun.lock packages/frontend/src/lib/queryClient.ts packages/frontend/src/lib/api.ts packages/frontend/src/App.tsx
git commit -m "feat(frontend): add TanStack Query client and provider"
```

---

### Task 2: Skeleton primitive

**Files:**
- Create: `packages/frontend/src/components/ui/skeleton.tsx`

**Interfaces:**
- Produces: `Skeleton` component — `(props: React.HTMLAttributes<HTMLDivElement>) => JSX.Element`.

- [ ] **Step 1: Create the primitive** (matches existing `PageLoader` pulse style)

```tsx
import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/ui/skeleton.tsx
git commit -m "feat(frontend): add Skeleton primitive"
```

---

### Task 3: QueryBoundary component

**Files:**
- Create: `packages/frontend/src/components/shared/QueryBoundary.tsx`
- Test: `packages/frontend/src/components/shared/__tests__/query-boundary.test.tsx`

**Interfaces:**
- Consumes: `Skeleton` (Task 2).
- Produces:
  ```ts
  interface QueryBoundaryProps<T> {
    query: Pick<UseQueryResult<T>, 'data' | 'isPending' | 'isError' | 'error' | 'refetch'>
    skeleton?: React.ReactNode        // first-load placeholder; default: generic skeleton block
    isEmpty?: (data: T) => boolean    // treat success-with-no-rows as empty state
    empty?: React.ReactNode           // empty-state node; default generic
    children: (data: T) => React.ReactNode
  }
  function QueryBoundary<T>(props: QueryBoundaryProps<T>): JSX.Element
  ```

- [ ] **Step 1: Write failing tests**

`__tests__/query-boundary.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryBoundary } from '../QueryBoundary'

const base = { data: undefined, isPending: false, isError: false, error: null, refetch: vi.fn() }

describe('QueryBoundary', () => {
  it('renders skeleton while first load pending', () => {
    render(<QueryBoundary query={{ ...base, isPending: true }} skeleton={<div>SKELE</div>}>{() => <div>DATA</div>}</QueryBoundary>)
    expect(screen.getByText('SKELE')).toBeInTheDocument()
  })

  it('renders error card with retry that calls refetch', () => {
    const refetch = vi.fn()
    render(<QueryBoundary query={{ ...base, isError: true, error: new Error('boom'), refetch }}>{() => <div>DATA</div>}</QueryBoundary>)
    expect(screen.getByText('boom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('renders empty state when isEmpty true', () => {
    render(<QueryBoundary query={{ ...base, data: [] }} isEmpty={(d: unknown[]) => d.length === 0} empty={<div>EMPTY</div>}>{() => <div>DATA</div>}</QueryBoundary>)
    expect(screen.getByText('EMPTY')).toBeInTheDocument()
  })

  it('renders children on success with data', () => {
    render(<QueryBoundary query={{ ...base, data: [1] }}>{(d: number[]) => <div>rows:{d.length}</div>}</QueryBoundary>)
    expect(screen.getByText('rows:1')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `bun run test -- query-boundary`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `QueryBoundary.tsx`**

```tsx
import type { UseQueryResult } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Icon } from '@iconify/react'

interface QueryBoundaryProps<T> {
  query: Pick<UseQueryResult<T>, 'data' | 'isPending' | 'isError' | 'error' | 'refetch'>
  skeleton?: React.ReactNode
  isEmpty?: (data: T) => boolean
  empty?: React.ReactNode
  children: (data: T) => React.ReactNode
}

export function QueryBoundary<T>({ query, skeleton, isEmpty, empty, children }: QueryBoundaryProps<T>) {
  if (query.isPending) {
    return <>{skeleton ?? <Skeleton className="h-40 w-full" />}</>
  }
  if (query.isError) {
    const message = query.error instanceof Error ? query.error.message : '加载失败'
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <Icon icon="ph:warning-circle-light" className="size-8 text-destructive" />
        <p className="text-sm text-destructive">{message}</p>
        <Button size="sm" variant="outline" onClick={() => { void query.refetch() }}>重试</Button>
      </div>
    )
  }
  const data = query.data as T
  if (isEmpty?.(data)) {
    return <>{empty ?? <p className="py-8 text-center text-sm text-muted-foreground">暂无数据</p>}</>
  }
  return <>{children(data)}</>
}
```

- [ ] **Step 4: Run, verify pass**

Run: `bun run test -- query-boundary`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/shared/QueryBoundary.tsx packages/frontend/src/components/shared/__tests__/query-boundary.test.tsx
git commit -m "feat(frontend): add QueryBoundary with skeleton/error/empty states"
```

---

### Task 4: Query key registry + read hooks + test helper

**Files:**
- Create: `packages/frontend/src/lib/queries/keys.ts`
- Create: `packages/frontend/src/lib/queries/index.ts`
- Create: `packages/frontend/src/test/renderWithClient.tsx`
- Test: `packages/frontend/src/lib/queries/__tests__/queries.test.tsx`

**Interfaces:**
- Consumes: `apiService` methods (`src/lib/api.ts`).
- Produces (read hooks, all returning `UseQueryResult<...>`):
  - `useClusterStatus()` → data `ClusterStatus` (from `apiService.getClusterStatus()` → `response.data`)
  - `useStatus()` → `ApiStatus`
  - `useMetrics(range: '24h'|'7d'|'30d')` → `{ snapshot; history; summary }`
  - `useComponentStates(nodeIds?: string[])` → `ComponentState[]`
  - `useComponentDeployments(nodeIds?: string[])` → `Record<string, ComponentDeployStatus>`
  - `useSubscriptionJobs()` → `SubscriptionJob[]`
  - `useSubscriptionPolicy()` → `SubscriptionPolicy`
  - `useSubscriptionPreflight()` → `SubscriptionPreflight`
  - `useArtifacts()` → `ArtifactState[]`
  - `useConfigSchema()` / `useEffectiveConfig()`
  - `useNotificationHistory()` → records array
  - `useOpenApi()` → document
  - `useLogs(params)` → `LogsResult`
- Produces: `queryKeys` object; `renderWithClient(ui)` test helper.

Notes for the implementer: each read hook unwraps `apiService` the same way the current pages do (e.g. `getClusterStatus()` returns `ApiResponse`, pages read `.data`; if `response.success === false` throw `new Error(serverErrorMessage)` so QueryBoundary shows it). Keep unwrap logic in the hook's `queryFn`.

- [ ] **Step 1: Write the test helper** `src/test/renderWithClient.tsx`

```tsx
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export function makeTestClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
}

export function renderWithClient(ui: React.ReactElement, client = makeTestClient()) {
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) }
}
```

- [ ] **Step 2: Write failing test** `queries.test.tsx` (dedup: two hooks, one fetch)

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiService } from '@/lib/api'
import { useClusterStatus } from '@/lib/queries'

describe('useClusterStatus', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('dedupes concurrent callers into one apiService call', async () => {
    const spy = vi.spyOn(apiService, 'getClusterStatus').mockResolvedValue({ success: true, data: { nodes: [] }, timestamp: '' } as any)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const a = renderHook(() => useClusterStatus(), { wrapper })
    const b = renderHook(() => useClusterStatus(), { wrapper })
    await waitFor(() => expect(a.result.current.data).toBeDefined())
    await waitFor(() => expect(b.result.current.data).toBeDefined())
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run, verify fail**

Run: `bun run test -- queries`
Expected: FAIL (module `@/lib/queries` not found).

- [ ] **Step 4: Implement `keys.ts`**

```ts
export const queryKeys = {
  clusterStatus: ['cluster-status'] as const,
  status: ['status'] as const,
  metrics: (range: string) => ['metrics', range] as const,
  componentStates: (nodeIds?: string[]) => ['component-states', nodeIds ?? null] as const,
  componentDeployments: (nodeIds?: string[]) => ['component-deployments', nodeIds ?? null] as const,
  subscriptionJobs: ['subscription-jobs'] as const,
  subscriptionPolicy: ['subscription-policy'] as const,
  subscriptionPreflight: ['subscription-preflight'] as const,
  artifacts: ['artifacts'] as const,
  configSchema: ['config-schema'] as const,
  effectiveConfig: ['effective-config'] as const,
  notificationHistory: ['notification-history'] as const,
  openApi: ['openapi'] as const,
  logs: (key: string) => ['logs', key] as const,
}
```

- [ ] **Step 5: Implement `index.ts`** — one `useQuery` per endpoint. Representative entries (implementer repeats the pattern for every hook in Interfaces):

```ts
import { useQuery } from '@tanstack/react-query'
import { apiService } from '@/lib/api'
import { queryKeys } from './keys'
import type { ClusterStatus } from '@/lib/types' // adjust to actual type location

function unwrap<T>(res: { success: boolean; data?: T; error?: unknown }): T {
  if (!res.success || res.data === undefined) {
    const msg = typeof res.error === 'string' ? res.error : '请求失败'
    throw new Error(msg)
  }
  return res.data
}

export function useClusterStatus() {
  return useQuery({
    queryKey: queryKeys.clusterStatus,
    queryFn: async () => unwrap<ClusterStatus>(await apiService.getClusterStatus()),
  })
}

export function useStatus() {
  return useQuery({ queryKey: queryKeys.status, queryFn: () => apiService.getStatus() })
}

export function useMetrics(range: '24h' | '7d' | '30d') {
  return useQuery({
    queryKey: queryKeys.metrics(range),
    queryFn: async () => unwrap(await apiService.getMetrics(range)),
  })
}
// ...remaining hooks follow the same unwrap/useQuery shape.
export { queryKeys } from './keys'
```

- [ ] **Step 6: Run, verify pass**

Run: `bun run test -- queries`
Expected: PASS (dedup test: spy called once).

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/lib/queries packages/frontend/src/test/renderWithClient.tsx
git commit -m "feat(frontend): add query key registry and read hooks"
```

---

### Task 5: Mutation hooks

**Files:**
- Create: `packages/frontend/src/lib/queries/mutations.ts`
- Modify: `packages/frontend/src/lib/queries/index.ts` (re-export)
- Test: `packages/frontend/src/lib/queries/__tests__/mutations.test.tsx`

**Interfaces:**
- Consumes: `apiService` write methods, `queryKeys`.
- Produces mutation hooks that invalidate affected keys on success. Group by domain:
  - Node writes → invalidate `clusterStatus`: `useUpdateNode`, `useDeleteNode`, `useAddNode`, `useUpdateNodeKernels`
  - Agent actions → invalidate `clusterStatus`: `useAgentAction` (start/stop/restart), `useClusterHealthCheck`
  - Kernel → invalidate `componentStates` + `clusterStatus`: `useKernelAction`
  - Deploy → invalidate `componentDeployments` + `componentStates`: `useStartDeployment`, `useRetryDeployment`, `useCancelDeployment`
  - Subscription → invalidate `subscriptionJobs`: `useStartSubscriptionJob`, `useRetrySubscriptionJob`, `useUpdateSubscriptionPolicy` (invalidate `subscriptionPolicy`)
  - Config → invalidate `effectiveConfig`: `usePatchConfigValues`, `useRestoreConfig`

- [ ] **Step 1: Write failing test** (representative: `useUpdateNode` invalidates cluster status)

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import { apiService } from '@/lib/api'
import { queryKeys } from '@/lib/queries'
import { useUpdateNode } from '@/lib/queries/mutations'

it('invalidates cluster status after updateNode', async () => {
  vi.spyOn(apiService, 'updateNode').mockResolvedValue({ success: true, data: {}, timestamp: '' } as any)
  const client = new QueryClient()
  const spy = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useUpdateNode(), { wrapper })
  await result.current.mutateAsync({ nodeId: 'n1', patch: { enabled: true } })
  await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.clusterStatus }))
})
```

- [ ] **Step 2: Run, verify fail**

Run: `bun run test -- mutations`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `mutations.ts`** — representative:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiService } from '@/lib/api'
import { queryKeys } from './keys'

export function useUpdateNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { nodeId: string; patch: Parameters<typeof apiService.updateNode>[1] }) =>
      apiService.updateNode(vars.nodeId, vars.patch),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: queryKeys.clusterStatus }) },
  })
}
// ...remaining mutation hooks follow the same shape, invalidating the keys listed in Interfaces.
```

- [ ] **Step 4: Run, verify pass**

Run: `bun run test -- mutations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/queries/mutations.ts packages/frontend/src/lib/queries/index.ts packages/frontend/src/lib/queries/__tests__/mutations.test.tsx
git commit -m "feat(frontend): add mutation hooks with query invalidation"
```

---

### Tasks 6–18: Migrate consumers

Each consumer task follows the SAME recipe. Do them one file per task, committing after each so a reviewer can gate independently.

**Recipe (apply per file):**
1. Delete the file's data-fetch `useState` (`cluster`, `error`, list state that mirrors server data) and its `useEffect` + `refresh()` fetch, and any `setInterval`.
2. Call the relevant read hook(s) from `@/lib/queries`. For polling files, pass `refetchInterval` + `refetchIntervalInBackground: false` by having the hook accept an options override OR wrap with a local `useQuery` option (add an optional `options` param to the polling hooks — `useComponentDeployments`, `useSubscriptionJobs`, `useLogs`).
3. Wrap the data-rendering region in `<QueryBoundary>` with a page-appropriate `skeleton` and, where a list can be legitimately empty, `isEmpty` + `empty`.
4. Replace write calls with the Task 5 mutation hooks; keep existing success/error `toast` calls in `onSuccess`/`onError` (or around `mutateAsync`).
5. Remove now-dead local error rendering superseded by `<QueryBoundary>` / toast.
6. Update that file's existing test(s) to render via `renderWithClient` and mock `apiService`.
7. Run `bun run test` for the affected test, then `bun run build`. Commit.

**Per-file endpoint map (what each consumes):**

- **Task 6 — `components/layout/Sidebar.tsx`**: `useStatus()` (was `getStatus` → `mihomoAvailable`). Always-mounted; sharing the key with Dashboard is the primary dedup win.
- **Task 7 — `components/Dashboard.tsx`**: `useStatus()`, `useClusterStatus()`, `useMetrics(range)`. Update tests `dashboard-metrics-race.test.tsx`, `dashboard-refresh-error.test.tsx` to the new hooks (these currently assert on the old fetch/race + error behavior — rewrite them against `renderWithClient` + mocked `apiService`, asserting metrics race resolved by query keying and error surfaced via QueryBoundary).
- **Task 8 — `pages/nodes.tsx`**: `useClusterStatus()`; writes `useUpdateNode`, `useDeleteNode`, `useAddNode`. Update `nodes-kernel-edit.test.tsx`, `local-node-display.test.tsx` to `renderWithClient`.
- **Task 9 — `pages/agents.tsx`**: `useClusterStatus()`; `useAgentAction`, `useClusterHealthCheck`.
- **Task 10 — `pages/runtimes.tsx`**: `useClusterStatus()`, `useComponentStates([nodeId])`, kernel `detectKernels` (keep as on-demand query enabled by node selection, or `useMutation` since it's a POST); writes `useUpdateNodeKernels`, `useKernelAction`. Update `cluster-components.test.tsx`, `kernel-detection-dialog.test.tsx`.
- **Task 11 — `pages/deploy.tsx`**: `useClusterStatus()`, `useComponentDeployments()` (poll 4s), `useComponentStates()`; writes `useStartDeployment`, `useRetryDeployment`, `useCancelDeployment`, `useClusterHealthCheck`. Keep SSE wiring; on SSE message call `queryClient.invalidateQueries` for deployments instead of manual `refresh()`.
- **Task 12 — `pages/subscription.tsx`**: `useClusterStatus()`, `useSubscriptionPreflight()`, `useSubscriptionJobs()` (poll 5s); writes `useStartSubscriptionJob`, `useRetrySubscriptionJob`. Keep SSE; invalidate `subscriptionJobs` on message.
- **Task 13 — `pages/subscription-status.tsx`**: `useStatus()`, `useArtifacts()`, `useSubscriptionJobs()`, `useSubscriptionPolicy()`; write `useUpdateSubscriptionPolicy`.
- **Task 14 — `pages/outputs.tsx`**: `useArtifacts()`; `previewArtifact`/`validateArtifacts` stay as on-demand actions (mutation or manual `queryClient.fetchQuery`), invalidate `artifacts` after validate.
- **Task 15 — `pages/config.tsx`**: `useConfigSchema()`, `useEffectiveConfig()`, `useNotificationHistory()`; writes `usePatchConfigValues`, `useRestoreConfig`, and keep `validateConfigSource`/`previewConfigImport`/`testWebhook` as actions.
- **Task 16 — `pages/logs.tsx`**: `useLogs(params)` (poll 5s) + `useClusterStatus()` for node list. Update `logs.test.ts`.
- **Task 17 — `pages/api-docs.tsx`**: `useOpenApi()`. Update `api-docs.test.ts`.
- **Task 18 — `pages/actions.tsx`**: `updateSubscription` is a POST action → `useMutation`; no read migration needed beyond wiring the toast. Small file — verify no leftover fetch state.

Each task's steps:
- [ ] Rewrite the file per recipe.
- [ ] Update/rewrite that file's existing test(s) to `renderWithClient` + mocked `apiService`; run `bun run test -- <name>` green.
- [ ] `bun run build` green.
- [ ] Commit `refactor(frontend): migrate <file> to query hooks`.

---

### Task 19: Cleanup + full verification

**Files:** repo-wide (frontend).

- [ ] **Step 1: Grep for leftovers**

```bash
cd packages/frontend
grep -rn "setInterval\|\.catch(() => {})" src/pages src/components | grep -v test
```
Expected: no data-fetch `setInterval` or swallowed `.catch(() => {})` remain (SSE reconnect timers excepted).

- [ ] **Step 2: Full test suite**

Run: `bun run test`
Expected: all green.

- [ ] **Step 3: Lint + build**

Run: `bun run lint && bun run build`
Expected: clean.

- [ ] **Step 4: Commit any cleanup**

```bash
git commit -am "chore(frontend): remove dead fetch state after query migration"
```

---

## Self-Review Notes

- Spec §Decisions all mapped: library (T1), all-at-once scope (T6–18), skeleton (T2), inline error card + retry (T3), background-failure toast (T1 QueryCache.onError), polling refetchInterval + hidden pause (T11/12/16 + global `refetchOnWindowFocus:false`), useMutation writes (T5, applied T8–15).
- Empty vs error distinguished in `<QueryBoundary>` (T3).
- Existing tests touching migrated files are explicitly called out for rewrite (T7,8,10,16,17).
- Type names (`ClusterStatus`, `ApiStatus`, etc.) come from `@/lib/types` / `@/lib/api`; implementer confirms exact import path when wiring each hook.
