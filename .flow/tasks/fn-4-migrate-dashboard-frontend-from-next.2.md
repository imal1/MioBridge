---
satisfies: [R2, R3, R7]
---
## Description
Implement CLI dashboard-server routes for core update/status/artifacts, compatibility URLs, and static/API routing precedence against frozen contracts.

**Size:** M
**Files:** `packages/cli/src/dashboard/server/coreRoutes.ts`, `packages/cli/src/dashboard/server/httpServer.ts`, `packages/cli/test/dashboard/server-core.test.ts`, `packages/cli/src/dashboard/commands.ts`

## Approach
- Reuse the CLI core composition and artifact/status APIs; no business logic copies.
- Preserve file content disposition, content types, missing-file errors, long update behavior, and health semantics.
- Reserve `/api/*` and four compatibility URLs before any static/history fallback.
- Use actual HTTP-server tests for method/status/header/content parity.

## Investigation targets
**Required**:
- `frontend/src/pages/api/file/[name].ts` — download/header behavior.
- `frontend/src/pages/api/status.ts`, `update.ts`, `health.ts` — core endpoint semantics.
- `packages/core/src/mioBridgeCore.ts:16-32` — public update/status APIs.
- `packages/core/src/artifacts/artifactService.ts` — artifact/read behavior.
- `packages/cli/src/dashboard/provider.ts:32-98` — compatibility URL contract.

## Acceptance
- [ ] Core/artifact/health routes match frozen method/status/body/header contracts.
- [ ] All four compatibility URLs work through CLI server and are never captured by static fallback.
- [ ] API routing rejects unsupported methods and traversal safely.
- [ ] External-cwd live HTTP tests prove server works without Next runtime.

## Done summary
Implemented CLI dashboard-server core routes and compatibility URLs.

### Routes ported
- `GET /api/status` → `deps.core.getStatus()`, returns `{ success, data, timestamp }`
- `GET /api/update` → `deps.core.updateSubscription()`, returns `{ success, data, message, timestamp }`
- `GET /health` → returns `{ status, timestamp, uptime, memory, version }`
- `GET /api/file/subscription` → `subscription.txt` with `text/plain` content-type
- `GET /api/file/clash` → `clash.yaml` with `text/yaml` content-type
- `GET /api/file/raw` → `raw.txt`, returns 404 JSON on error
- `GET /subscription.txt`, `GET /clash.yaml`, `GET /raw.txt` → compat URLs

### New files
- `packages/cli/src/dashboard/server/coreRoutes.ts` — core/artifact/health routes
- `packages/cli/src/dashboard/server/compatRoutes.ts` — compatibility URL routes
- `packages/cli/test/dashboard/server-core.test.ts` — 15 tests

### Verification
- 106/106 CLI tests pass, 30/30 core tests pass
- TypeScript typecheck passes
- Lint passes
- Zero Next.js or frontend-server imports
## Evidence
- Commits:
- Tests: packages/cli/test/dashboard/server-core.test.ts (15/15 pass), packages/cli/test/* (106/106 pass), packages/core/* (30/30 pass)
- PRs: