---
satisfies: [R2, R7]
---

## Description

Split the mixed `NodeManager` into core Agent HTTP, registry/repository, and aggregation services while retaining SSH credentials, deployment state/callbacks, auto-deploy, and systemd/dashboard operations in explicit frontend adapters.

**Size:** M
**Files:** `packages/core/src/nodes/**`, `packages/core/test/nodes/**`, `frontend/src/server/services/nodeManager.ts`, `frontend/src/server/services/deployManager.ts`, `frontend/src/server/services/sshCredential.ts`

## Approach

- Freeze and preserve the Agent HMAC wire contract before extraction: URL/port, headers, canonical payload, timeout, response validation, partial failures, node identity, and redaction.
- Keep node serialization, file/Redis repository behavior, offline kernel shape, aggregation, and main/child ownership in core. Inject the implemented `StateStore` interface (normally selected by `createStateStore({ paths, env, logger })`) rather than importing or rebuilding a singleton.
<!-- Updated by plan-sync: fn-1-extract-headless-core-to-packagescore.2 exposed instance-scoped StateStore creation -->
- Define a frontend operations adapter for deployment/SSH callbacks rather than retaining a hidden reverse core dependency.
- Wire later through injected `RemoteSourceCollector` instead of dynamic-importing the artifact service.

## Investigation targets

**Required** (read before coding):
- `frontend/src/server/services/nodeManager.ts:1-70` — current imports, module paths, service cycle, and deployment delegate.
- `frontend/src/server/services/nodeManager.ts` — Agent requests, registry serialization, aggregation, watch, and operations inventory.
- `frontend/src/server/services/__tests__/nodeManager.test.ts` — complete node/HMAC compatibility suite.
- `frontend/src/server/middleware/__tests__/hmac.test.ts` — server-side signing verification contract.
- `frontend/src/server/services/__tests__/deploy-integration.test.ts` — deploy callback seam.

**Optional** (reference as needed):
- `frontend/src/server/services/updateChecker.ts` — node-service interface consumption.
- `frontend/src/server/services/sshCredential.ts` — frontend-only credential ownership.

## Acceptance

- [ ] Core exposes focused Agent client, node repository/registry, and aggregation contracts with no SSH/deployment imports.
- [ ] Frontend operations behavior, including deploy callbacks and SSH mutations, remains covered and functional without duplicated registry logic.
- [ ] HMAC URL, headers, payload, timeout, validation, partial failures, identity checks, and redaction match frozen fixtures.
- [ ] Existing nodes data and offline/status shapes remain readable and equivalent without migration.

## Done summary
拆分了无 SSH/部署依赖的 AgentClient、NodeRepository 和 NodeAggregationService；新增 frontend NodeOperationsAdapter 保持部署回调归属与兼容行为。
## Evidence
- Commits:
- Tests: bun run core:typecheck, bun run core:test (21 passed), bunx vitest run frontend/src/server/services/__tests__/nodeManager.test.ts frontend/src/server/services/__tests__/deploy-integration.test.ts frontend/src/server/middleware/__tests__/hmac.test.ts (90 passed)
- PRs: