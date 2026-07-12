---
satisfies: [R1, R4, R6, R8]
---

## Description

Freeze migration-before behavior and establish the independent `@miobridge/core` workspace/package boundary before moving stateful services. Choose and prove the package output contract for Bun, compiled Node, and Next consumers; add boundary/import-safety tests and root package commands.

**Size:** M
**Files:** `package.json`, `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/test/**`

## Approach

- Capture golden fixtures from current services before modifying their implementation.
- Use explicit package exports; do not expose internal helpers or allow frontend path aliases.
- Decide source export versus built `dist` through executable Bun, Node, and Next package-consumption probes.
- Add automated dependency and import-side-effect checks covering filesystem, config, process, network, and environment-path snapshots.

## Investigation targets

**Required** (read before coding):
- `package.json:7-20` — current workspaces and root scripts.
- `frontend/package.json` — dependency and Vitest versions to align with.
- `frontend/vitest.config.ts:5-20` — current server-test discovery and alias pattern.
- `frontend/src/server/services/__tests__/mioBridgeService.test.ts` — artifact failure/equivalence behavior.
- `frontend/src/server/services/__tests__/proxySources.test.ts` — source normalization fixtures.

**Optional** (reference as needed):
- `frontend/next.config.js:15-25` — workspace tracing and external package behavior.
- `tsconfig.json` — legacy root configuration that must not define the core project.

## Acceptance

- [ ] `@miobridge/core` has explicit exports and independent test/typecheck/build commands wired through root scripts.
- [ ] Migration-before golden fixtures cover output ordering/dedup/naming, partial and total failure, status, offline nodes, and HMAC error paths.
- [ ] Fresh external-cwd probes demonstrate package consumption under Bun and compiled Node and establish the supported Next consumption shape.
- [ ] Boundary tests reject Next/React/frontend/SSH/deployment imports and detect import-time side effects.

## Done summary
Established the private @miobridge/core workspace with explicit compiled ESM exports and independent build, typecheck, and test commands. Frozen migration-before artifact, ordering, deduplication, naming, failure, status, offline-node, and HMAC contracts. Added package-boundary and external-cwd Bun/Node import-safety probes, wired the frontend workspace dependency, and proved the package shape with a production Next build.
## Evidence
- Commits:
- Tests: bun run core:test (5 passed), bun run core:typecheck, bun run typecheck, cd frontend && bunx vitest run src/server/services/__tests__/mioBridgeService.test.ts src/server/services/__tests__/proxySources.test.ts src/server/services/__tests__/nodeManager.test.ts (91 passed), bun run core:build && bun run frontend:build, git diff --check
- PRs: