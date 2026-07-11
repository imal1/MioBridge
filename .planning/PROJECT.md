# MioBridge

## What This Is

MioBridge is a TypeScript subscription converter being reshaped around an installable Linux command. The `miobridge` CLI is the primary product: it installs and diagnoses required tooling, manages configuration and conversion, and can optionally install and control the existing Next.js Dashboard. The Vercel deployment remains a frontend-only, read-only demonstration rather than an operational control plane.

## Core Value

Other users can install and operate the core converter through a lightweight `miobridge` Linux command without being required to deploy the web application.

## Current Milestone

### Goal

Deliver a CLI-first Linux distribution with guided dependency setup, complete core conversion operations, an optional persistent Dashboard, and a safe frontend-only Vercel demo.

### Success

- A new Linux user can install `miobridge`, complete guided dependency setup, and obtain a working converter without manually cloning or running the Dashboard.
- Core configuration, update, generation, status, and diagnostic workflows are available as stable CLI commands.
- Users who want the web UI can start it in the foreground or manage it as a persistent background service; headless users do not install or run it.
- Vercel publishes only the frontend demonstration and cannot perform host mutation, SSH deployment, filesystem conversion, or process management.

## Product Direction

### In Scope

- Linux x64 and arm64 command installation and upgrades
- Guided Bun, mihomo, and yq capability discovery/installation with version and integrity checks
- CLI access to the existing converter's core operations and generated compatibility artifacts
- Optional Dashboard installation and foreground/background lifecycle commands
- Frontend-only Vercel demo configuration with synthetic/read-only data
- Release artifacts and automated verification of install, core CLI, Dashboard lifecycle, and demo safety

### Out of Scope

- macOS or Windows CLI support in this milestone
- Making Vercel the production control plane or persistent converter runtime
- Multi-instance control-plane scaling
- Replacing mihomo or supporting every optional kernel during initial CLI extraction
- A GUI-first installer

## Technical Context

- The current application is a Next.js Pages Router full-stack service under `frontend/`; framework-independent backend logic lives in `frontend/src/server/**`.
- Runtime state must remain under `~/.config/miobridge`, independent of the current working directory.
- External binaries resolve from `~/.config/miobridge/bin/`, then repository `bin/`, then `PATH`.
- Existing compatibility URLs and generated files (`raw.txt`, `subscription.txt`, `clash.yaml`) must remain usable.
- Linux service management may use systemd, but foreground mode and actionable fallbacks are required.
- The distributed baseline remains intact: the main node owns generated artifacts, child Agents expose kernel-tagged source URLs, normal checks use public HMAC HTTP, and SSH is reserved for deployment and diagnosis (`.Codex/memory/project-architecture.md`, `.Codex/memory/bug-fixes.md`).
- Configuration changes must be validated, backed up, and atomically replaced; `MIOBRIDGE_CONFIG_DIR` remains the supported isolation override for tests (`.Codex/memory/config-patterns.md`, `.claude/roadmap/README.md`).
- Existing `.claude/commands/miobridge:deploy.md`, `.claude/commands/miobridge:diag.md`, and `.claude/commands/miobridge:release.md` describe the former server/GitHub workflow and are migration inputs for the new installed CLI commands, not current deployment authority.

## Constraints

- Preserve the existing converter behavior while separating it from Next.js adapters.
- Keep API routes thin and SSR service calls in-process; do not add an Express server.
- Default management access must be local-only; demo hosting must not expose operational mutations.
- Downloads executed during installation must be versioned and checksum verified.
- Preserve standalone Dashboard packaging of `.next/static` and `public`.
- Preserve explicit password-or-key SSH semantics, keep private keys outside `nodes.yaml`, redact credentials and complete proxy URLs, and use checked same-directory temporary files plus atomic renames for privileged remote updates.
- CI typechecking must target `frontend/`; repository-root `npx tsc --noEmit` is not a valid gate (`.Codex/memory/ci-cd-pipeline.md`).

## Source Reconciliation

- `.Codex/memory/MEMORY.md` is the durable memory index; its architecture, configuration, bug-fix, CI, and deployment topic files inform this milestone.
- `.claude/roadmap/README.md` records the shipped distributed-node baseline and compatibility URLs that the CLI extraction must preserve.
- `.Codex/memory/deployment-flow.md` and `.Codex/memory/ci-cd-pipeline.md` describe Vercel as the former production deployment. That assumption is superseded by the current decision: Linux CLI/scripted deployment is primary, while Vercel is only a frontend demonstration.
- The old command documents' `deploy.yml`, `health-check.yml`, release symlink, and localhost HTTP checks must be replaced or migrated to `miobridge` CLI equivalents; they must not be silently presented as active workflows.

## Key Decisions

| Decision | Rationale | Status |
|----------|-----------|--------|
| The Linux `miobridge` command is the primary product boundary | Makes headless use lightweight and scriptable | Accepted |
| The Dashboard is optional and controlled through CLI subcommands | Keeps the web interface pluggable rather than mandatory | Accepted |
| Vercel is a frontend-only read-only demo | Avoids presenting an ephemeral serverless deployment as an operational control plane | Accepted |
| Runtime state stays in `~/.config/miobridge` | Preserves cwd-independent operation and existing conventions | Accepted |
| Initial platform scope is Linux x64/arm64 | Matches systemd and binary packaging capabilities while limiting release risk | Accepted |

---
*Initialized from codebase mapping, deployment documentation, and current user intent on 2026-07-12.*
