---
satisfies: [R3, R6, R7]
---

## Description

Extract domain primitives, `RuntimePaths`, the side-effect-free logger contract, YAML/config services, and file/Redis StateStore implementations into core while preserving every existing path, environment, key, and serialized-data contract.

**Size:** M
**Files:** `packages/core/src/runtime/**`, `packages/core/src/config/**`, `packages/core/src/state/**`, `packages/core/src/types/**`, `packages/core/test/**`

## Approach

- Resolve runtime paths at instance creation through an injected policy; never cache cwd or environment-derived paths at module scope.
- Preserve existing config defaults, YAML shapes, Redis environment names/key namespace, file locking, and trailing-separator containment behavior.
- Keep Vercel `/tmp` selection in a frontend-supplied policy rather than embedding platform behavior in core.
- Keep logger creation free of filesystem writes; frontend owns Winston/file transports.

## Investigation targets

**Required** (read before coding):
- `frontend/src/server/runtimePaths.ts:4-14` — current base-directory rules.
- `frontend/src/server/config/index.ts:1-23,91-100` — eager YAML/config coupling.
- `frontend/src/server/services/yamlService.ts` — config loading/default behavior.
- `frontend/src/server/services/stateStore.ts` — file/Redis formats and selection.
- `frontend/src/server/utils/logger.ts:6-30` — cycle and import-time directory creation.

**Optional** (reference as needed):
- `frontend/src/server/__tests__/runtimePaths.test.ts` — current path tests.
- `frontend/src/server/services/__tests__/stateStore.test.ts` — containment and persistence tests.

## Key context

Repository `bin/` is a development fallback based on an explicit application root; it is not runtime state and must not make cwd authoritative. Existing StateStore records must remain readable without migration.

## Acceptance

- [ ] All runtime directories and asset/binary roots are expressed by one injected, containment-tested policy with the required precedence.
- [ ] Core config/YAML imports perform no read, mkdir, singleton construction, or environment-path snapshot.
- [ ] Existing file and Redis data, keys, environment variables, defaults, and locks work without migration.
- [ ] Tests cover external cwd, trailing separators, traversal, explicit Vercel policy injection, and isolated `MIOBRIDGE_CONFIG_DIR` instances.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
