---
satisfies: [R2, R3, R4, R7]
---
## Description
Inventory every Next API route and SSR data dependency, freeze HTTP parity fixtures, and create CLI-owned dashboard-server composition interfaces. No production route retirement yet.

**Size:** M
**Files:** `packages/cli/src/dashboard/server/**`, `packages/cli/test/dashboard/contracts/**`, `frontend/src/pages/api/**`, `frontend/src/pages/*.tsx`

## Approach
- Classify routes as core/artifact, config/logs, operations/deploy, HMAC, SSE, or downloads.
- Capture method/query/body/status/headers/error shapes from current handlers before porting.
- Compose server only from public core and explicit CLI operations ports; prohibit frontend-server/Next imports.
- Define route registration and request/response abstractions with deterministic test adapters.

## Investigation targets
**Required**:
- `frontend/src/pages/api/status.ts`, `update.ts`, `health.ts`, and `file/[name].ts` — core/compat contracts.
- `frontend/src/pages/api/cluster/events.ts` — SSE cleanup/heartbeat.
- `frontend/src/server/middleware/hmac.ts` — signing/replay contract.
- `frontend/src/server/core.ts:16-64` — composition pattern, never import target.
- `packages/cli/src/composition.ts` — CLI composition/injection seam.
- `frontend/src/pages/index.tsx`, `config.tsx`, `nodes.tsx`, `deploy.tsx` — SSR dependencies.

## Acceptance
- [ ] Contract inventory covers every route and SSR loader with methods, inputs, status/body/header and error semantics.
- [ ] Golden contract tests cover HMAC, SSE, downloads, core routes, and operations route categories.
- [ ] Dashboard server composition has no Next/frontend-server import and uses explicit core/operations ports.
- [ ] Baseline contract fixtures run before and after each route port.

## Done summary
Froze 30 API routes and 4 SSR data loaders, created CLI-owned dashboard server composition seam, and added golden contract tests.

### Contract inventory
- **Core/artifact routes** (7): `GET /api/status`, `GET /api/update`, `GET /health`, `GET /api/file/{subscription,clash,raw}`, `GET /api/cluster/status`
- **Cluster operations** (15): `GET /api/cluster/health`, `GET /api/cluster/update`, `POST /api/cluster/nodes`, `POST /api/cluster/agent/{restart,start,stop,uninstall,update}`, `POST /api/cluster/deploy`, `GET /api/cluster/deploy/progress`, `GET /api/cluster/deploy/status`, `POST /api/cluster/kernel/{detect,install,uninstall}`
- **Config/logs** (3): `GET/POST /api/configs`, `GET /api/logs`
- **YAML** (4): `GET /api/yaml/config`, `GET /api/yaml/frontend`, `POST /api/yaml/generate`, `GET /api/yaml/validate`
- **Convert/diagnose** (3): `POST /api/convert`, `GET /api/diagnose/mihomo`, `GET /api/test/protocols`
- **SSE** (1): `GET /api/cluster/events`
- **SSR loaders** (4): `index.tsx`, `config.tsx`, `nodes.tsx`, `deploy.tsx`

### Composition seam
- Extended `DashboardServerDependencies` with 5 ports: `core`, `operations`, `config`, `yaml`, `convert`
- `DashboardOperationsPort`: 15 methods covering cluster, agent, deploy, kernel operations
- `DashboardConfigPort`: config CRUD + remote logs
- `DashboardYamlPort`: YAML config CRUD + validation
- `DashboardConvertPort`: content conversion, mihomo diagnose, protocol tests
- Zero Next.js or `frontend/src/server/**` imports

### Framework-agnostic HMAC
- Ported `frontend/src/server/middleware/hmac.ts` to `packages/cli/src/dashboard/server/hmac.ts`
- Same contract: timestamp window (±30s), replay protection, timing-safe comparison, localhost bypass
- Factory function `createHmacVerifier(secret)` for test isolation

### Golden contract tests
- `hmac.golden.test.ts`: 7 tests covering localhost, missing headers, expired timestamp, replay, wrong signature, valid signed request, empty secret
- `http-contracts.golden.test.ts`: 21 tests covering all route categories with method, status, body, and error semantics
- 28/28 passing
## Evidence
- Commits:
- Tests: packages/cli/test/dashboard/contracts/hmac.golden.test.ts (7/7 pass), packages/cli/test/dashboard/contracts/http-contracts.golden.test.ts (21/21 pass), packages/cli/test/* (69/69 pass), packages/core test (30/30 pass)
- PRs: