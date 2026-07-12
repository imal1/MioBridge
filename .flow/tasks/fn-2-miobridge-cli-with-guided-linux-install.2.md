---
satisfies: [R2, R6]
---
## Description
Implement Linux dependency discovery and confirmed managed installers for mihomo, Bun, yq, and optional sing-box, reporting configured/managed/PATH/missing origins and using pinned, verified, atomic downloads.

**Size:** M
**Files:** `packages/cli/src/setup/**`, `packages/cli/src/platform/**`, `packages/cli/src/command.ts`, `packages/cli/src/index.ts`, `packages/cli/test/setup/**`

## Approach
- Detect supported Linux x64/arm64 and distro for guidance; keep OS-specific code in CLI.
- Resolve dependencies with core RuntimePaths precedence and explain which capability needs each binary.
- Require explicit confirmation for each install; refusal is a successful no-change outcome.
- Download pinned artifacts to temporary files, verify SHA256, chmod, probe version, then atomically replace managed binaries.
- Inject network, prompt, filesystem, and platform adapters for deterministic tests; redact URLs carrying credentials.
- Extend the existing `parseCommand()` / `runCli()` dispatcher and `CliDependencies` injection seam; keep `main.ts` limited to Node composition and process exit.

<!-- Updated by plan-sync: fn-2-miobridge-cli-with-guided-linux-install.1 established parseCommand/runCli and CliDependencies as the command integration seam -->

## Investigation targets
**Required**:
- `packages/core/src/runtime/runtimePaths.ts` — managed/repo/PATH candidates.
- `packages/cli/src/command.ts` — actual parser, dispatcher, output, and exit-code contracts to extend.
- `packages/cli/src/composition.ts` — actual Node composition and injected runtime-path options.
- `scripts/lib/config.sh:5-62` — existing yq download mapping and pitfalls.
- `scripts/lib/install.sh` — existing architecture/download behavior to supersede.
- `scripts/lib/system.sh` — OS/architecture detection patterns.
- `.Codex/memory/bug-fixes.md:10-16` — path/secret safety constraints.

## Acceptance
- [ ] Setup reports configured/managed/PATH/missing for all required/optional dependencies.
- [ ] No binary is installed without explicit confirmation; refusal leaves disk unchanged and remains actionable.
- [ ] Pinned x64/arm64 downloads require checksum/version validation and atomic rollback.
- [ ] Tests cover unsupported OS/arch, network failure, checksum mismatch, partial download, permission errors, and redaction.

## Done summary
Added Linux x64/arm64 dependency discovery and guided managed installation for mihomo, Bun, yq, and optional sing-box with configured/managed/PATH/missing reporting, explicit confirmation, pinned verified artifacts, credential redaction, archive extraction, version probing, and atomic rollback.
## Evidence
- Commits:
- Tests: bun run cli:test (20 passed), bun run cli:typecheck, bun run cli:build, bun run core:test (30 passed), bun run lint, bun run typecheck, bun run build, cd agent && bun test (29 passed), verified six pinned release SHA-256 digests against downloaded GitHub assets, .flow/bin/flowctl validate --spec fn-2-miobridge-cli-with-guided-linux-install --json, git diff --check
- PRs: