---
satisfies: [R1, R4, R6, R7]
---

## Description

Extract artifact generation, update/status behavior, backup handling, and version metadata into core and expose them through the `MioBridgeCore` composition root plus only the focused public services consumers require. Extend the existing explicit root export while preserving the compiled ESM `dist` package contract.
<!-- Updated by plan-sync: fn-1-extract-headless-core-to-packagescore.1 selected explicit compiled ESM dist exports -->

**Size:** M
**Files:** `packages/core/src/artifacts/**`, `packages/core/src/status/**`, `packages/core/src/mioBridgeCore.ts`, `packages/core/src/index.ts`, `packages/core/test/**`

## Approach

- Inject local/kernel sources, `RemoteSourceCollector`, the implemented `RuntimePaths` and `StateStore` instances, logger, clock/process, and version metadata at composition time. Compose config through the exported `YamlService` and `ConfigService` constructors; do not add compatibility singletons.
<!-- Updated by plan-sync: fn-1-extract-headless-core-to-packagescore.2 established constructor-based runtime/config/state APIs -->
- Use the exported `NodeAggregationService.collectRemoteNodeSources()` as the concrete remote-source collector, composed from the same `NodeRepository`/`StateStore` instance and `AgentClient`; do not recreate Agent validation, HMAC, or node persistence inside the artifact facade.
<!-- Updated by plan-sync: fn-1-extract-headless-core-to-packagescore.4 exposed focused node services and preserved partial-failure collection -->
- Reuse the exported `buildClashSubscriptionResult`, `SingBoxAdapter`, `MihomoAdapter`, `XrayAdapter`, and `V2rayAdapter` implementations rather than rebuilding normalization or kernel conversion inside the facade.
<!-- Updated by plan-sync: fn-1-extract-headless-core-to-packagescore.3 exposed focused source and kernel adapter APIs -->
- Preserve main-node artifact ownership, exact byte generation, warnings/partial-success rules, total-failure no-replacement, backups, and status fields.
- Remove the dynamic `MioBridgeService`/`NodeManager` cycle and the core-to-frontend package metadata dependency.
- Build before validating the public API from external-cwd Bun and compiled Node smoke scripts; consumers must import `@miobridge/core`, never `packages/core/src`.

## Investigation targets

**Required** (read before coding):
- `frontend/src/server/services/mioBridgeService.ts:31-42,44-91` — current injection seam and remote-source cycle.
- `frontend/src/server/services/mioBridgeService.ts:94-190` — artifact generation and partial-success ordering.
- `frontend/src/server/services/__tests__/mioBridgeService.test.ts` — failure isolation and output contract.
- `frontend/src/server/version.ts:1-10` — frontend metadata coupling to remove.
- `frontend/src/server/services/proxySources.ts` — output naming/dedup contract.

**Optional** (reference as needed):
- `frontend/src/pages/api/status.ts` — focused status consumer needs.
- `frontend/src/pages/api/update.ts` — update facade consumer needs.

## Acceptance

- [ ] `MioBridgeCore` wires services without cycles, module-level singletons, frontend imports, or import-time effects.
- [ ] Golden tests prove exact raw/Base64/Clash bytes and preserve warnings, partial success, failure no-replacement, backups, and status fields.
- [ ] Version/build metadata is injected or core-owned and never read from `frontend/package.json`.
- [ ] External-cwd Bun and compiled Node scripts call config, conversion, update, generation, and status without Next.

## Done summary
Extracted artifact generation and status into framework-neutral services and exposed an injected MioBridgeCore composition root.
## Evidence
- Commits:
- Tests: bun run core:typecheck, bun run core:test (26 passed), bun run core:build, git diff --check
- PRs: