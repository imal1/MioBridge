# fn-2 miobridge CLI with guided Linux install and dashboard lifecycle

## Goal & Context

Make MioBridge easy for other people to deploy. Today deployment means cloning
the repo and running a Next.js standalone build — too heavy for users who just
want a subscription converter. The product direction: a `miobridge` command is
the primary distribution; the web dashboard is a pluggable optional layer that
must never make the project feel heavy.

The CLI targets Linux only for now. After installation it guides the user
through installing the runtime dependencies the project needs (mihomo, bun,
yq, optionally sing-box), exposes the project's core functionality as
subcommands, and manages the dashboard lifecycle: `miobridge dashboard` starts
the frontend in the foreground, with options to run it as a persistent
background service and stop it.

## Architecture & Data Models

- New workspace package (e.g. `packages/cli`) that consumes `@miobridge/core`
  (fn-1) — no business logic in the CLI layer itself (D-05).
- Command surface (final naming at implementer's discretion, keep it small):
  - `miobridge setup` / first-run wizard: detect Linux distro, check/install
    mihomo, bun, yq (and optionally sing-box) into `~/.config/miobridge/bin/`
    following the existing binary-preference order (managed bin/ -> repo bin/ ->
    PATH). Interactive guidance, not silent global installs.
  - Core commands mapping to core services: update/convert subscription,
    generate artifacts (`raw.txt`, `subscription.txt`, `clash.yaml`), status,
    node/agent operations as exposed by `MioBridgeCore`.
  - `miobridge dashboard` — start frontend in foreground; `--daemon`/
    `start|stop|status` variants manage a persistent background process
    (systemd user unit or supervised child process — implementer chooses, but
    stop/status must work without guessing PIDs).
- Runtime state stays under `~/.config/miobridge` (RuntimePaths from core).
- Distribution mechanism (npm/bun global install vs curl installer script) to
  be decided during planning — must not require cloning the repo.

## API Contracts

- CLI exit codes: 0 success, non-zero on failure with actionable stderr.
- `miobridge dashboard start --daemon` / `stop` / `status` are idempotent
  (starting a running dashboard or stopping a stopped one reports state, does
  not error).
- Dashboard serves the same compatibility URLs as today
  (`/subscription.txt`, `/clash.yaml`, `/raw.txt`, `/health`).
- Dependency check output clearly distinguishes: found in managed bin / found
  on PATH / missing (with guided install offer).

## Edge Cases & Constraints

- Linux only for this spec; macOS/Windows explicitly out of scope (do not
  block future support with Linux-only assumptions in core — put OS specifics
  in the CLI layer).
- Never install system-wide packages without explicit user confirmation.
- Must work on a headless server (no browser, no GUI).
- Daemon mode must survive SSH session exit and be discoverable after
  reconnect (status command).
- The CLI must function fully without the dashboard installed/built —
  the web layer is pluggable, not required.

## Acceptance Criteria

- **R1:** A user on a fresh Linux machine can install the `miobridge` command without cloning the repo.
- **R2:** First run guides the user through checking/installing mihomo, bun, and yq into the managed bin directory, with confirmation before any install.
- **R3:** Core functionality (subscription update, artifact generation, status) works from the CLI with no Next.js process running.
- **R4:** `miobridge dashboard` starts the frontend in foreground; a daemon variant supports start/stop/status and survives SSH logout.
- **R5:** All CLI state lives under `~/.config/miobridge`; removing the dashboard leaves CLI functionality intact.

## Boundaries

Out of scope:
- macOS/Windows support.
- Rewriting the frontend (fn-4) — the CLI launches whatever dashboard build
  exists.
- Multi-user/auth.
- Replacing the existing GitHub-Actions deployment for the author's own nodes
  (this spec is about third-party deployability; existing deploy flow keeps
  working).

## Decision Context

Why a CLI instead of docker-compose or a bigger web installer: the goal is
lightweight adoption — a single command that can run headless, with web UI as
opt-in. This depends on fn-1: without the core package, every CLI command would
have to boot Next.js or duplicate logic, defeating the purpose. Distribution
and daemonization mechanisms are deliberately left to planning/implementation
discretion; the spec locks the user-visible contract (guided install,
subcommands, dashboard lifecycle) rather than the mechanism.
