---
satisfies: [R3, R5]
---
## Description
Create `packages/cli` with a testable command dispatcher, Node composition root using public `@miobridge/core` exports, and stable `update` plus `status [--json]` commands that work without frontend/dashboard files.

**Size:** M
**Files:** `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/src/**`, `packages/cli/test/**`, `package.json`

## Approach
- Reuse `createRuntimePaths`, StateStore, kernel/node adapters, and `MioBridgeCore`; CLI owns only process/fs/logger/terminal adapters.
- Separate parsing/command execution from `process.exit`; map domain failures to actionable stderr and nonzero codes.
- Keep JSON output decoration-free and deterministic.
- Build as compiled ESM and Bun executable-compatible source without frontend imports.

## Investigation targets
**Required**:
- `packages/core/src/index.ts` — supported public surface.
- `packages/core/src/mioBridgeCore.ts:9-32` — facade composition and commands.
- `frontend/src/server/core.ts:16-64` — Node adapter composition pattern, not an import target.
- `packages/core/src/runtime/runtimePaths.ts:38-71` — runtime path policy.
- `frontend/src/server/cli/deploy-commands.ts` — testable command/function style.

**Optional**:
- `packages/core/test/boundary.test.ts` — external-cwd and boundary probes.

## Acceptance
- [ ] CLI package has independent build/test/typecheck scripts and root aliases.
- [ ] `update` and human/JSON `status` call one injected core composition with no frontend imports.
- [ ] External-cwd tests prove all state stays under an isolated base directory and no dashboard is required.
- [ ] Parsing, help/version, stdout/stderr, JSON purity, and exit codes are covered.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
