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
- The frontend composition adapter supplies `createRuntimePaths` with an explicit application root and, on Vercel, `platformBaseDir: vercelRuntimeBaseDir()`; it also injects the frontend logger into YAML/state services. Core must not infer Vercel or recreate Winston transports.
<!-- Updated by plan-sync: fn-1-extract-headless-core-to-packagescore.2 made platform paths and logging explicit composition inputs -->
- Replace frontend source/kernel implementations with deprecated shims for the exported core APIs: `buildClashSubscriptionResult`, `SingBoxAdapter`, `MihomoAdapter`, `XrayAdapter`, and `V2rayAdapter`; construct adapters with frontend-owned process, filesystem, runtime-path, and logger collaborators.
<!-- Updated by plan-sync: fn-1-extract-headless-core-to-packagescore.3 used injected adapter classes instead of compatibility singletons -->
- Cut node consumers over to the exported `AgentClient`, `NodeRepository`, and `NodeAggregationService`. Preserve `NodeOperationsAdapter` as a real frontend implementation for deploy callbacks/SSH operations, and retire duplicated Agent HMAC, registry parsing, and aggregation logic from the legacy `NodeManager` path.
<!-- Updated by plan-sync: fn-1-extract-headless-core-to-packagescore.4 established core node services plus the frontend operations seam -->
- Build the frontend composition adapter with `new MioBridgeCore({ paths, state, logger, metadata, local, remote, mihomo })`: `SingBoxAdapter` satisfies `LocalSourceCollector`, `NodeAggregationService` satisfies `RemoteSourceCollector`, and `MihomoAdapter` supplies conversion, health, and version methods. Route update/status consumers through `core.updateSubscription()` and `core.getStatus()`; focused file consumers may use `core.artifacts.getFileContent()`.
<!-- Updated by plan-sync: fn-1-extract-headless-core-to-packagescore.5 exposed injected facade members and structural collector ports -->
- Consume the compiled ESM `dist` export selected in task .1. The baseline production Next build passed without `transpilePackages`; add transpilation or tracing changes only if the extracted runtime implementation later proves they are required.
<!-- Updated by plan-sync: fn-1-extract-headless-core-to-packagescore.1 proved compiled dist consumption without transpilePackages -->
- Keep type-only browser imports separated and scan client output for Node/core runtime leakage.

## Investigation targets

**Required** (read before coding):
- `frontend/src/instrumentation.ts:1-7` — required Node runtime guard.
- `frontend/src/instrumentation-node.ts` — scheduler/service composition consumer.
- `frontend/src/pages/api/update.ts` — thin core update route.
- `packages/core/src/mioBridgeCore.ts` — actual facade constructor and public `config`, `state`, `artifacts`, and `status` members.
- `frontend/src/pages/api/cluster/status.ts` — node aggregation route.
- `frontend/src/server/services/nodeOperationsAdapter.ts` — frontend-owned deploy callback seam that must remain outside core.
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
Cut Next API routes, SSR loaders, and Node instrumentation over to the injected @miobridge/core composition root; retained frontend deployment/SSH operations and converted legacy source/kernel modules to deprecated re-export shims.
## Evidence
- Commits:
- Tests: bun run --cwd frontend test --run (324 passed), bun run lint, bun run typecheck, bun run core:test (26 passed), bun run build, client bundle scan (no @miobridge/core or Node runtime markers)
- PRs: