---
satisfies: [R2, R6]
---
## Description
Implement Linux dependency discovery and confirmed managed installers for mihomo, Bun, yq, and optional sing-box, reporting configured/managed/PATH/missing origins and using pinned, verified, atomic downloads.

**Size:** M
**Files:** `packages/cli/src/setup/**`, `packages/cli/src/platform/**`, `packages/cli/test/setup/**`

## Approach
- Detect supported Linux x64/arm64 and distro for guidance; keep OS-specific code in CLI.
- Resolve dependencies with core RuntimePaths precedence and explain which capability needs each binary.
- Require explicit confirmation for each install; refusal is a successful no-change outcome.
- Download pinned artifacts to temporary files, verify SHA256, chmod, probe version, then atomically replace managed binaries.
- Inject network, prompt, filesystem, and platform adapters for deterministic tests; redact URLs carrying credentials.

## Investigation targets
**Required**:
- `packages/core/src/runtime/runtimePaths.ts` — managed/repo/PATH candidates.
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
TBD

## Evidence
- Commits:
- Tests:
- PRs:
