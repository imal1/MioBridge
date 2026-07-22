# Dashboard Data Layer Redesign

Date: 2026-07-21
Status: Approved design, pending implementation plan

## Problem

The Vite dashboard (`packages/frontend`) has no shared data-fetching layer.
Each page and several always-mounted components fetch independently in their
own `useEffect`, producing four user-visible defects:

1. **Duplicate requests.** `getClusterStatus` alone is called independently by
   8+ places (`Sidebar`, `Dashboard`, `nodes`, `deploy`, `logs`, `runtimes`,
   `agents`, `subscription`, `subscription-status`). Because `Sidebar` is always
   mounted, navigating to any page fires the same endpoint at least twice
   simultaneously. Nothing dedupes or caches these calls.
2. **Compounding polling.** `deploy.tsx` polls every 4s, `subscription.tsx` and
   `logs.tsx` every 5s via raw `setInterval`, with no dedup and no pause when the
   tab is hidden.
3. **No loading feedback.** First-load latency shows nothing useful; layout is
   empty until data resolves.
4. **Silent failures.** Error handling is inconsistent — some callers use
   `.catch(() => {})` and swallow errors, others fall through to an empty list.
   A failed request renders as a blank list with no explanation and no retry.

## Goals

- Eliminate duplicate simultaneous requests for the same endpoint.
- Give every data-backed view a clear first-load state, error state, and empty
  state — three distinct states, never conflated.
- Preserve existing polling cadence but pause it when the tab is hidden.
- Keep writes consistent with reads (a successful write refreshes affected data
  automatically).

## Decisions (agreed)

- **Library:** adopt `@tanstack/react-query`.
- **Scope:** migrate all pages, `Sidebar`, and `Dashboard` in one pass.
- **Loading UX:** skeleton screens (placeholder shapes matching real layout).
- **Error UX:** inline error card with a retry button, scoped to the failed
  region; distinct from the empty state. Background-refresh failures (data
  already on screen) additionally raise a sonner toast.
- **Polling:** `refetchInterval` per hook, `refetchIntervalInBackground: false`.
- **Writes:** migrate to `useMutation` with `invalidateQueries`.

## Architecture

### Root wiring — `App.tsx`

Mount `QueryClientProvider` wrapping `AppProvider`. A single `QueryClient` with
defaults:

- `staleTime: 30_000` — a freshly-mounted component reusing a live query key
  does not trigger a duplicate network fetch.
- `gcTime: 300_000` (5 min).
- `retry: 1`.

`ky` currently retries GET up to 3 times (`api.ts` `retry.limit: 3`). Stacking
that under React Query's retry means a failed GET blocks through 3 ky attempts
before React Query even sees the error, delaying the inline error card. Resolve
by lowering ky's GET retry limit to `0` and letting React Query own retries.

### Query hooks — `src/lib/queries/`

One hook per read endpoint, each wrapping the existing `apiService` method and
exposing a stable `queryKey`:

- `useClusterStatus()` → `apiService.getClusterStatus()`, key `['cluster-status']`
- `useStatus()` → `apiService.getStatus()`
- `useMetrics(range)` → key `['metrics', range]`
- `useComponentStates(nodeIds?)`, `useDeployStatus`, `useSubscriptionJobs`,
  `useLogs(...)`, `useArtifacts`, `useConfigs`, etc. — one per current GET.

Because `Sidebar` and the active page both call `useClusterStatus()`, React
Query collapses them into a single in-flight request plus a shared cache entry.
This is the core fix for defect #1.

Query keys are centralized (e.g. a `queryKeys` object) so mutations can
invalidate precisely.

### Shared UX component — `<QueryBoundary>`

A single component consumes a query result and renders one of three states:

- **loading (first load):** skeleton (`ui/skeleton.tsx`, new).
- **error:** inline error card — icon, `error.message`, retry button calling
  `refetch()`.
- **success:** if data is empty → dedicated empty state; otherwise children.

Background refetches do not blank the screen; stale data stays visible.

New primitive: `ui/skeleton.tsx`. Per-page skeleton shapes (table rows, cards)
are composed from it to match each view's real layout.

### Global background-failure toast

Configure `QueryCache.onError`: raise a sonner toast **only** when the failing
query already has cached data (i.e. a background refresh failed while content is
visible). First-load errors are handled by the inline card, so they do not also
toast.

### Polling

Remove the raw `setInterval` blocks in `deploy.tsx`, `subscription.tsx`,
`logs.tsx`. Move cadence into the relevant hook's `refetchInterval` (4s / 5s /
5s respectively) with `refetchIntervalInBackground: false`.

### Writes — `useMutation`

Migrate write paths (`deployNode`, `addNode`, `updateNode`, `deleteNode`,
kernel actions, agent actions, subscription jobs, config patches, etc.) to
`useMutation`. On success, `invalidateQueries` for the affected keys so reads
refresh automatically. Preserve existing success/failure sonner toasts.

### Cleanup

Delete per-page hand-written `useEffect` fetches, `.catch(() => {})` swallows,
and per-page `loading`/`error` `useState`, now superseded by the query hooks and
`<QueryBoundary>`.

## Testing

- vitest + @testing-library/react (already present).
- Test renders wrap children in a `QueryClientProvider` (a shared test helper).
- Cover `<QueryBoundary>` three states: skeleton on first load, error card +
  retry invokes `refetch`, empty state on empty success.
- Cover representative query hooks (dedup / key stability) and at least one
  mutation invalidation path.

## Out of scope

- Migrating polling to SSE push (`lib/sse.ts` exists but this is a larger change
  deferred to a later effort).
- Backend/API changes — this is a frontend-only redesign.

## Affected files (indicative)

- `packages/frontend/package.json` — add dependency.
- `packages/frontend/src/App.tsx` — provider.
- `packages/frontend/src/lib/api.ts` — ky retry limit.
- `packages/frontend/src/lib/queries/*` — new hooks (new dir).
- `packages/frontend/src/components/ui/skeleton.tsx` — new.
- `packages/frontend/src/components/shared/QueryBoundary.tsx` — new.
- All `packages/frontend/src/pages/*.tsx`, `Sidebar.tsx`, `Dashboard.tsx` —
  migrated to hooks + `<QueryBoundary>`.
