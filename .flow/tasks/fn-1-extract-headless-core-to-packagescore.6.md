---
satisfies: [R2, R5, R8]
---

## Description

Cut Next API routes, SSR loaders, and Node instrumentation over to `@miobridge/core`, retain thin framework/operations adapters, and replace migrated legacy service modules with deprecated re-export shims containing no implementation.

**Size:** M
**Files:** `frontend/src/pages/api/**`, `frontend/src/pages/*.tsx`, `frontend/src/instrumentation-node.ts`, `frontend/src/server/**`, `frontend/next.config.js`

## Approach

- Inventory server consumers and classify them as core, Next boundary, or frontend operations before changing imports.
- SSR continues to call services directly; API routes remain thin; Node-only initialization stays behind the existing runtime guard.
- Add `transpilePackages` or tracing configuration only if the package-consumption decision and clean build demonstrate it is required.
- Keep type-only browser imports separated and scan client output for Node/core runtime leakage.

## Investigation targets

**Required** (read before coding):
- `frontend/src/instrumentation.ts:1-7` — required Node runtime guard.
- `frontend/src/instrumentation-node.ts` — scheduler/service composition consumer.
- `frontend/src/pages/api/update.ts` — thin core update route.
- `frontend/src/pages/api/cluster/status.ts` — node aggregation route.
- `frontend/src/pages/index.tsx` — SSR direct-service consumer.
- `frontend/next.config.js:15-36` — standalone tracing and compatibility rewrites.

**Optional** (reference as needed):
- `frontend/src/server/__tests__/api/cluster/cluster.test.ts` — route integration patterns.

## Acceptance

- [ ] Server-side routes, SSR, and instrumentation import the supported `@miobridge/core` surface and preserve existing response behavior.
- [ ] Migrated legacy business modules are deprecated re-export-only shims; Next/SSH/deployment/logging adapters remain explicitly documented frontend implementations.
- [ ] The Node runtime guard remains intact and client bundles contain no Node builtins or core runtime implementation.
- [ ] Existing frontend API, SSR, deployment, and server tests pass after cutover with no duplicate active core implementation.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
