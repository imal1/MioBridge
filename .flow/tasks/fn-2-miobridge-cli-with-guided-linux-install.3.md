---
satisfies: [R1, R6]
---
## Description
Produce self-contained linux-x64/linux-arm64 CLI release archives, checksum manifests, and a clone-free bootstrap installer with atomic install/upgrade/uninstall behavior that preserves user data.

**Size:** M
**Files:** `packages/cli/package.json`, `scripts/install-cli.sh`, `scripts/package-cli-release.sh`, `.github/workflows/release.yml`, `packages/cli/test/release/**`

## Approach
- Compile Bun executables for both Linux architectures and package versioned archives with executable permissions.
- Installer accepts an explicit version/repository override, selects architecture, downloads archive plus checksum, verifies, and atomically installs to a user bin directory.
- Never require git/Bun/Node on target; use common POSIX tools and fail with actionable prerequisites.
- Upgrade preserves previous executable on failure; uninstall removes only CLI-owned binaries/metadata unless explicit dashboard removal is requested.

## Investigation targets
**Required**:
- `packages/core/package.json` — current workspace build conventions.
- `.github/workflows/ci.yml` — Bun/action versions and verification style.
- `scripts/install.sh` — current repo-clone bootstrap to replace for third parties.
- `scripts/prepare-standalone.sh` — artifact verification conventions.
- `package.json:7-32` — workspace/root script integration.

## Acceptance
- [ ] Release build emits x64/arm64 archives and SHA256 manifest with deterministic names and executable CLI.
- [ ] Installer works without repository, git, Bun, or Node and supports version/repository/install-dir overrides.
- [ ] Checksum/download/install failures preserve the previous version; uninstall preserves config/data by default.
- [ ] Tests inspect archives, executable bits, architecture mapping, checksum enforcement, upgrade rollback, and external-cwd execution.

## Done summary
Packaged Bun-compiled linux-x64 and linux-arm64 CLI archives with deterministic release names and SHA256SUMS. Added a clone-free, pinned installer with architecture detection, checksum enforcement, transactional replacement, safe CLI-only uninstall, and release contract tests. Added the tag-driven GitHub Release workflow and workspace release commands.
## Evidence
- Commits: f99a0f1
- Tests: bun run cli:typecheck, bun run cli:test (4 files, 25 tests), bun run cli:release (real x64/arm64 cross-compilation), shasum -a 256 -c SHA256SUMS, flowctl validate --spec fn-2-miobridge-cli-with-guided-linux-install
- PRs: