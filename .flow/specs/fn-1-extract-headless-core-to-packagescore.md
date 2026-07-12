# Extract headless core to packages/core

## Overview

Extract MioBridge's framework-independent backend into the Node-only Bun workspace package `packages/core` (`@miobridge/core`). The work is a dependency-direction refactor: freeze current behavior, remove import-time cycles and side effects, split mixed node responsibilities, expose a `MioBridgeCore` composition root, then cut Next API/SSR/instrumentation consumers over without changing user-visible behavior.

## Scope

- Establish the core workspace package, explicit public exports, independent typecheck/test/build scripts, and Bun plus compiled-Node headless smoke tests.
- Move domain types, source normalization, runtime paths, configuration, state stores, kernel adapters, artifact generation, status, node aggregation, and the HMAC Agent client into core.
- Split SSH/deployment/systemd/dashboard lifecycle behavior into frontend-owned operations adapters; do not pull it into core.
- Cut server-side frontend consumers to `@miobridge/core`; legacy business-service paths become deprecated re-export shims, while genuinely Next-only adapters remain implemented in frontend.
- Preserve existing files, Redis keys, protocol wire format, outputs, partial-success behavior, and production standalone behavior.

## Approach

1. Freeze pre-migration golden fixtures and boundary checks before moving implementation.
2. Extract bottom-up: pure domain code and runtime ports; config/state; kernel adapters; Agent/node services; artifacts/status/facade.
3. Resolve cycles through injected collaborators and composition-root wiring. Core imports must not create directories, read config, snapshot environment paths, start processes, or issue network requests.
4. Keep a narrow export surface: `MioBridgeCore` plus consumer-required focused services and types; internal adapters/helpers stay private.
5. Switch API routes, SSR loaders, and Node instrumentation in one cutover, retaining thin Next boundaries and guarded Node-only imports.
6. Finish with clean standalone verification, CI/root command wiring, documentation, and durable project-memory updates.

## Quick commands

```bash
bun run core:test && bun run core:typecheck
bun run lint && bun run typecheck && bun run build
cd agent && bun test
```

## Boundaries / non-goals

- No `miobridge` CLI, guided setup, remote installation, or Linux service management; those belong to `fn-2-miobridge-cli-with-guided-linux-install`.
- No SSR-to-Vite migration or dashboard server replacement; those belong to `fn-4-migrate-dashboard-frontend-from-next`.
- No Express server, auth/multi-user work, Agent protocol change, conversion behavior change, data migration, or new persistence format.
- Next request/response helpers, HMAC middleware, UI serialization, frontend Winston presentation, SSH credentials/deployment callbacks, and dashboard lifecycle may remain real frontend implementations.

## Decision Context

- `packages/core` is the canonical boundary from D-01; a physical move without dependency inversion would preserve the existing `MioBridgeService`/`NodeManager` and config/YAML/logger cycles.
- The package starts private with explicit exports and an independent build/typecheck contract. The implementation task decides source-versus-`dist` consumption by proving both Bun and compiled Node use plus a clean Next standalone build; frontend must never import `packages/core/src` directly.
- `RuntimePaths` is an injected policy resolved at instance creation. Managed state stays below `~/.config/miobridge`, `MIOBRIDGE_CONFIG_DIR` isolates tests, Vercel `/tmp` is a frontend-supplied policy, and repository binary fallback uses an explicit application root rather than cwd.
- Core receives a side-effect-free logger interface; Winston/file transport initialization remains an adapter responsibility.
- Existing file and Redis StateStore formats, keys, environment names, HMAC request format, timeouts, validation, and redaction remain compatibility contracts.

## Risks and mitigations

- **Behavior drifts during extraction:** capture migration-before golden fixtures and run equivalence tests after each layer.
- **Deployment behavior is lost while splitting NodeManager:** keep an explicit frontend operations adapter and integration tests around deploy callbacks and SSH mutations.
- **Next dev succeeds but standalone omits workspace assets:** run a clean production build, inspect traced core/assets, start the standalone server, and request all compatibility URLs.
- **Node-only code leaks into browser bundles:** classify consumer imports, retain the `NEXT_RUNTIME === 'nodejs'` guard, and scan client output for Node/core runtime modules.
- **Tests pass only from repository cwd:** execute path and headless smoke matrices from external temporary working directories.

## Acceptance Criteria

- **R1:** Core config, conversion, artifact generation, and status are callable from a plain Bun script and from compiled JavaScript under Node, outside the repository cwd, without starting or importing Next/React/frontend runtime code.
- **R2:** Frontend API routes, SSR loaders, and Node instrumentation consume `@miobridge/core`; legacy business-service paths contain deprecated re-exports only, while documented Next/SSH/deployment adapters remain frontend-owned with no duplicated core implementation.
- **R3:** Config, data, logs, backups, dist assets, and managed binaries follow one injected `RuntimePaths` policy: default beneath `~/.config/miobridge`, test isolation through `MIOBRIDGE_CONFIG_DIR`, explicit app-root repo-bin fallback, then PATH, all independent of cwd and protected by containment tests.
- **R4:** Migration-before golden fixtures prove byte-identical `raw.txt`, `subscription.txt`, and `clash.yaml` outputs plus preserved ordering, exact-URL deduplication, naming conflicts, warnings, partial success, total-failure no-replacement, backup, and status behavior after cutover.
- **R5:** `bun run lint`, frontend and core typechecks/tests, `bun run build`, and Agent tests pass; a clean standalone server includes traced core/assets and serves `/subscription.txt`, `/clash.yaml`, `/raw.txt`, and `/health` successfully.
- **R6:** Importing any `packages/core` public module under Bun or Node performs no filesystem mutation/config read, process spawn, network request, environment-path snapshot, or module-level singleton construction.
- **R7:** Existing `config.yaml`, `nodes.yaml`, artifact files, Redis keys/data formats, main/child ownership, offline kernel shape, HMAC URL/headers/payload/timeout/response validation, and secret/URL redaction work without migration or protocol change.
- **R8:** Package-boundary checks reject core dependencies on Next, React, frontend aliases/paths, SSH/deployment modules, and prevent Node-only core runtime implementation from entering client bundles.

## Test notes

- Golden fixtures must be captured before implementation moves and must cover local plus remote sources, malformed sources, duplicate URLs, Clash name collisions, partial and total failure, status fields, offline nodes, and HMAC error paths.
- Import-safety probes run in fresh Bun and Node processes with filesystem/process/network spies and external cwd values.
- Runtime-path tests cover trailing separators, traversal containment, managed/repo/PATH binary precedence, and explicit Vercel policy injection.
- Consumer cutover includes existing frontend Vitest integration suites and deploy callback coverage so the NodeManager split cannot orphan operations behavior.

## Documentation

Update `README.md`, `README.zh-CN.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/CI-CD.md`, and conditionally `docs/DEPLOYMENT.md` to describe the workspace boundary and real commands. Update `.Codex/memory/project-architecture.md` and `.Codex/memory/coding-conventions.md`; update CI/deployment/config memory only if those flows change materially.

## References

- `9c83c4d:.planning/phases/01-headless-core-boundary/01-RESEARCH.md` — authoritative boundary research and migration order.
- `package.json:8-20` — current frontend-only workspace and root command gaps.
- `frontend/src/server/services/mioBridgeService.ts:31-42,84-91` — injection seam and dynamic NodeManager cycle.
- `frontend/src/server/services/nodeManager.ts:24-70` — import-time path snapshot, service cycle, and mixed deploy responsibility.
- `frontend/src/server/config/index.ts:1-23,91-100` and `frontend/src/server/utils/logger.ts:6-30` — config/YAML/logger initialization cycle and import-time directory creation.
- `frontend/src/server/runtimePaths.ts:4-14` and `frontend/src/server/services/mihomoService.ts:57-66` — current base-dir policy and cwd binary fallbacks.
- `frontend/src/server/version.ts:1-10` — frontend package metadata coupling.
- `frontend/src/instrumentation.ts:1-7` and `frontend/next.config.js:15-36` — Node guard, tracing, and compatibility rewrites.
- `.Codex/memory/bug-fixes.md:14-21,36-57` — TDZ, path containment, kernel shape, main-node, and HMAC regressions to preserve.

## Early proof point

Task `fn-1-extract-headless-core-to-packagescore.1` proves the package can be consumed by Bun, compiled Node, and Next without reverse imports or import-time side effects while pre-migration fixtures remain frozen. If it fails, re-evaluate package output shape and composition-root boundaries before extracting stateful services.

## Requirement coverage

| Req | Description | Task(s) | Gap justification |
|-----|-------------|---------|-------------------|
| R1 | Bun/Node headless consumption | .1, .5 | — |
| R2 | Frontend cutover and shims | .4, .6 | — |
| R3 | Unified cwd-independent runtime paths | .2, .3 | — |
| R4 | Byte/behavior equivalence | .1, .5 | — |
| R5 | Full CI/build/standalone verification | .6, .7 | — |
| R6 | Import-time side-effect freedom | .1, .2, .5 | — |
| R7 | Persistence, node, HMAC, and redaction compatibility | .2, .4, .5 | — |
| R8 | Dependency and browser-bundle boundaries | .1, .6, .7 | — |
