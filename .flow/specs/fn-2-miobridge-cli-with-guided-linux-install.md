# miobridge CLI with guided Linux install and dashboard lifecycle

## Overview

Ship `miobridge` as a self-contained Linux command that consumes `@miobridge/core`, works headlessly without Next.js, guides users through managed dependencies, and treats the dashboard as a separately installable provider. Distribution uses checksum-verified GitHub Release binaries so a fresh machine needs neither a repository clone nor a preinstalled JS runtime.

## Scope

- Add `packages/cli` with stable commands: `setup`, `update`, `status [--json]`, and `dashboard foreground|start|stop|status`.
- Compose `MioBridgeCore` from public core exports and CLI-owned Node/process/filesystem/logger adapters; do not copy business logic.
- Detect Linux architecture/distro and report each dependency as configured/managed/PATH/missing. Guide confirmed installation of mihomo, Bun, and yq into the managed directory; sing-box remains optional.
- Build self-contained linux-x64 and linux-arm64 release binaries plus a version-pinned, checksum-verifying, atomic bootstrap installer.
- Define a versioned dashboard provider manifest so current Next standalone and future fn-4 Vite output share the same CLI lifecycle contract.
- Use a systemd user service for persistent dashboard daemon mode, with explicit lingering guidance and no PID guessing.

## Approach

1. Establish CLI composition, exit/output contracts, test harness, and headless core commands.
2. Implement dependency discovery and confirmed managed installation with pinned downloads, checksums, rollback, and redaction.
3. Compile and package standalone Linux binaries; install atomically to `~/.local/bin` without requiring Bun/Node/git.
4. Introduce a dashboard provider manifest and foreground runner independent of the dashboard framework.
5. Manage daemon lifecycle through a systemd user unit and stable launcher/manifest contract.
6. Add release/VM-style integration gates, compatibility URL smoke tests, docs, and durable memory updates.

## Quick commands

```bash
bun run cli:test && bun run cli:typecheck && bun run cli:build
bun run core:test && bun run lint && bun run typecheck && bun run build
cd agent && bun test
```

## Boundaries / non-goals

- Linux x64/arm64 only; macOS, Windows, musl-specific guarantees, containers, and non-systemd daemon fallback are deferred.
- No silent system-wide package-manager installs, root systemd unit, auth/multi-user work, or replacement of the author's Vercel production flow.
- No frontend rewrite. The current dashboard provider may wrap Next standalone; fn-4 replaces the provider artifact without changing CLI commands.
- No broad node/Agent administration command surface beyond what R1-R5 require.

## Decision Context

- A global npm/Bun package cannot bootstrap a fresh machine that lacks Bun/Node, so GitHub Releases provide Bun-compiled Linux executables and SHA256 manifests. A small shell installer selects architecture, verifies a pinned release, and atomically installs the command.
- `setup` still checks/guides mihomo, Bun, and yq as required by R2; the compiled CLI itself does not depend on Bun. Output explains which capabilities need each dependency and installs only after confirmation.
- Dashboard daemonization is a systemd user service. This provides stable identity, restart/status/journal behavior, and survival across SSH logout when lingering is enabled. Unsupported user-systemd environments return actionable errors.
- Dashboard lifecycle consumes a manifest containing version, entrypoint, arguments, health URL, and artifact root. It never hard-codes Next paths; fn-4 can supply a Vite/static-server provider.
- CLI human output goes to stdout/stderr with actionable nonzero failures; `--json` emits decoration-free structured output for automation. Idempotent already-running/already-stopped states exit 0.

## Risks and mitigations

- **Supply-chain compromise:** pin release versions, require SHA256 verification, use temporary files and atomic replacement, and preserve the previous binary on failure.
- **CLI/core drift:** enforce imports from `@miobridge/core` public exports and run headless update/status tests with no dashboard files or process.
- **Daemon disappears after SSH logout:** detect systemd user manager/lingering state and provide an explicit confirmed enablement path or actionable guidance.
- **Next coupling blocks fn-4:** make provider manifest and launcher framework-neutral and keep Next packaging in a provider adapter.
- **Legacy service/port conflict:** detect existing system-wide `miobridge.service` and occupied ports before daemon start.

## Acceptance Criteria

- **R1:** A fresh Linux x64 or arm64 user installs a checksum-verified self-contained `miobridge` command from a versioned release without cloning the repository or preinstalling Bun/Node/git; failed install or upgrade preserves the previous version.
- **R2:** `miobridge setup` reports configured/managed/PATH/missing origin and, only after explicit confirmation, guides pinned managed installation of mihomo, Bun, and yq under the runtime bin directory; sing-box is optional and secrets/full proxy URLs are never logged.
- **R3:** `miobridge update` and `miobridge status [--json]` compose and call `@miobridge/core` with no Next.js process or dashboard artifact present, preserve exit-code/output contracts, and keep runtime state under the injected MioBridge base directory.
- **R4:** A versioned provider manifest runs the installed dashboard in foreground; systemd-user `dashboard start|stop|status` is idempotent, survives SSH logout when lingering is enabled, exposes journal/status guidance, and preserves the four compatibility URLs.
- **R5:** Dashboard artifacts, service files, logs, and runtime data have distinct ownership beneath user directories; removing the dashboard/provider leaves CLI update/status and existing config/data intact.
- **R6:** Release, installer, dependency, daemon, and dashboard flows have automated x64/arm64 contract tests plus Linux integration evidence for checksum rollback, confirmation refusal, no-dashboard headless use, service reconnect, and live compatibility URLs.

## Test notes

- Unit tests cover parsing, exit codes, JSON purity, dependency origin, confirmation refusal, architecture/distro mapping, checksum mismatch, atomic rollback, manifest validation, unit escaping, and idempotent daemon states.
- Headless integration uses fake local/mihomo/remote adapters and `MIOBRIDGE_CONFIG_DIR` to generate artifacts and status without importing frontend code.
- Release checks inspect tar contents/executable bits/checksum manifests and run compiled binaries from external working directories.
- systemd unit rendering runs everywhere; real linger/SSH persistence is verified in a Linux systemd VM/job rather than assumed from mocks.

## Documentation

Update English/Chinese README, installation, deployment, troubleshooting, contributing, CI/release docs, and relevant architecture/deployment/CI/config memories. Clearly separate self-hosted CLI/dashboard lifecycle from Vercel production deployment.

## References

- `packages/core/src/mioBridgeCore.ts:9-32` — public facade composition and command APIs.
- `packages/core/src/runtime/runtimePaths.ts:38-71` — canonical runtime and binary precedence policy.
- `frontend/src/server/core.ts:16-64` — existing Node composition adapter to mirror without importing frontend.
- `scripts/manage.sh:85-162` — repo-bound build and root systemd flow to replace for third-party users.
- `scripts/prepare-standalone.sh:4-32` — current Next provider artifact requirements.
- `.Codex/memory/config-patterns.md:10-19` — runtime path and binary conventions.
- `.Codex/memory/deployment-flow.md:10-20` — Vercel production boundary that must remain independent.

## Early proof point

Task `fn-2-miobridge-cli-with-guided-linux-install.1` proves a compiled CLI can compose the public core and run update/status from an external cwd without Next or dashboard files. If it fails, revise the core public composition seams before building installers or daemon lifecycle.

## Requirement coverage

| Req | Description | Task(s) | Gap justification |
|-----|-------------|---------|-------------------|
| R1 | Clone-free self-contained install | .3, .6 | — |
| R2 | Guided managed dependencies | .2, .6 | — |
| R3 | Headless core commands | .1, .6 | — |
| R4 | Provider and persistent dashboard lifecycle | .4, .5, .6 | — |
| R5 | Dashboard optionality and data ownership | .1, .4, .6 | — |
| R6 | Release/Linux integration evidence | .2, .3, .5, .6 | — |
