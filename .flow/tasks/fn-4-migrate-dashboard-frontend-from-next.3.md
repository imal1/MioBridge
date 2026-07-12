---
satisfies: [R2, R4, R7]
---
## Description
Port config/YAML/logs, node/Agent/kernel/deployment operations, HMAC middleware, and cluster event streaming into CLI dashboard-server adapters while preserving frontend-owned Node operations ownership.

**Size:** M
**Files:** `packages/cli/src/dashboard/server/operationsRoutes.ts`, `packages/cli/src/dashboard/server/hmac.ts`, `packages/cli/src/dashboard/server/sse.ts`, `packages/cli/test/dashboard/server-operations.test.ts`

## Approach
- Extract/inject operations ports from current Node adapters rather than move SSH/deploy behavior into core.
- Preserve upload validation, deployment progress, route authorization, canonical HMAC/replay semantics, and Agent protocol boundaries.
- Preserve SSE event names, heartbeat, content type, disconnect cleanup, and error behavior.
- Keep routes thin and test with fake operations plus selected real integration suites.

## Investigation targets
**Required**:
- `frontend/src/pages/api/cluster/**` — operations route inventory.
- `frontend/src/pages/api/yaml/**`, `logs.ts`, `diagnose/mihomo.ts` — config/log contracts.
- `frontend/src/server/middleware/hmac.ts` — canonical auth behavior.
- `frontend/src/pages/api/cluster/events.ts` — SSE lifecycle.
- `frontend/src/server/services/nodeOperationsAdapter.ts` — operations ownership.
- `frontend/src/server/services/deployManager.ts` and `sshCredential.ts` — injected adapter boundaries.

## Acceptance
- [ ] Operations/config/log routes match contract fixtures without core HTTP coupling.
- [ ] HMAC timestamp/replay/body/error behavior matches existing protected routes.
- [ ] SSE preserves heartbeat/events and releases resources on disconnect.
- [ ] Agent HMAC and SSH deployment boundaries remain unchanged and covered by integration tests.

## Done summary
Ported operations, config, YAML, convert, and SSE routes to CLI dashboard server.

### Routes ported
- **Cluster operations** (15): status, health, update, nodes (POST), agent lifecycle (5), deploy, deploy progress/status, kernel detect/install/uninstall
- **Config/logs** (3): GET/POST configs, GET logs with query params
- **YAML** (4): config, frontend, generate (POST), validate
- **Convert/diagnose** (3): POST convert, GET diagnose/mihomo, GET test/protocols
- **SSE** (1): GET /api/cluster/events with heartbeat, periodic data, disconnect cleanup

### New files
- `packages/cli/src/dashboard/server/operationsRoutes.ts` — cluster + agent + deploy + kernel
- `packages/cli/src/dashboard/server/configRoutes.ts` — config + logs + YAML
- `packages/cli/src/dashboard/server/convertRoutes.ts` — convert + diagnose + test
- `packages/cli/src/dashboard/server/sse.ts` — framework-agnostic SSE helper
- `packages/cli/src/dashboard/server/sseRoutes.ts` — cluster event stream route
- `packages/cli/test/dashboard/server-operations.test.ts` — 22 tests

### Verification
- 106/106 CLI tests pass, 30/30 core tests pass
- TypeScript typecheck passes
- Lint passes
- Zero Next.js or frontend-server imports
## Evidence
- Commits:
- Tests: packages/cli/test/dashboard/server-operations.test.ts (22/22 pass), packages/cli/test/* (106/106 pass), packages/core/* (30/30 pass)
- PRs: