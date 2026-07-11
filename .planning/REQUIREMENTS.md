# Requirements: MioBridge CLI-first Distribution

## v1 Requirements

### Core Boundary

- [ ] **CORE-01**: Core configuration, conversion, artifact generation, and status behavior is callable without starting Next.js.
- [ ] **CORE-02**: CLI and Dashboard/API adapters share the same framework-independent application services rather than duplicating business logic.
- [ ] **CORE-03**: Runtime configuration, data, logs, backups, dist assets, and managed binaries consistently resolve beneath `~/.config/miobridge` independent of cwd, while `MIOBRIDGE_CONFIG_DIR` supports isolated tests.

### Linux Installation

- [ ] **INST-01**: A Linux x64 or arm64 user can install an executable named `miobridge` from a versioned release using one documented script command.
- [ ] **INST-02**: Installation detects Bun, mihomo, and yq capabilities and guides the user through installing missing required dependencies.
- [ ] **INST-03**: Downloaded executable artifacts use pinned versions and are checksum verified before execution.
- [ ] **INST-04**: Re-running install or upgrade is idempotent and preserves user configuration while reporting installed versions and paths.

### CLI Operations

- [ ] **CLI-01**: User can initialize, inspect, validate, update, back up, and roll back MioBridge configuration through `miobridge` commands using atomic persistence.
- [ ] **CLI-02**: User can update source subscriptions and generate `raw.txt`, `subscription.txt`, and `clash.yaml` from the command line.
- [ ] **CLI-03**: User can inspect health, Agent/kernel capability, generated artifact locations, installed version, service state, and redacted actionable logs/diagnostics from the command line.
- [ ] **CLI-04**: Commands return stable nonzero exit codes on failure and support non-interactive use suitable for shell automation.

### Optional Dashboard

- [ ] **DASH-01**: User can install or omit Dashboard assets independently of the core CLI workflow.
- [ ] **DASH-02**: `miobridge dashboard start` runs the Dashboard in the foreground with configurable host and port.
- [ ] **DASH-03**: User can start, stop, restart, and inspect status/logs for a persistent Dashboard background service.
- [ ] **DASH-04**: Dashboard lifecycle commands preserve standalone `.next/static` and `public` assets and bind management locally by default.

### Demo and Release Safety

- [ ] **DEMO-01**: Vercel CLI configuration builds and deploys only the `frontend` demonstration surface.
- [ ] **DEMO-02**: The public Vercel demo uses synthetic/read-only state and cannot invoke SSH, mutate host configuration, spawn conversion binaries, or manage services.
- [ ] **REL-01**: CI runs the frontend-scoped lint/typecheck/build gates and verifies Linux installation, core CLI conversion, Agent behavior, Dashboard foreground/background lifecycle, and Vercel demo safety boundaries.
- [ ] **REL-02**: Versioned release and deployment documentation replaces obsolete `deploy.yml`/health-check instructions and clearly distinguishes lightweight CLI installation, optional Dashboard usage, and frontend-only Vercel demonstration.

## Future Requirements

- **PLAT-01**: Support macOS installation and lifecycle conventions.
- **PLAT-02**: Support Windows installation and lifecycle conventions.
- **KERN-01**: Offer additional optional kernels through a plugin-style capability installer.
- **AUTH-01**: Support remotely exposed Dashboard administration with authenticated sessions and CSRF protection.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 1 | Pending |
| CORE-02 | Phase 1 | Pending |
| CORE-03 | Phase 1 | Pending |
| INST-01 | Phase 2 | Pending |
| INST-02 | Phase 2 | Pending |
| INST-03 | Phase 2 | Pending |
| INST-04 | Phase 2 | Pending |
| CLI-01 | Phase 3 | Pending |
| CLI-02 | Phase 3 | Pending |
| CLI-03 | Phase 3 | Pending |
| CLI-04 | Phase 3 | Pending |
| DASH-01 | Phase 4 | Pending |
| DASH-02 | Phase 4 | Pending |
| DASH-03 | Phase 4 | Pending |
| DASH-04 | Phase 4 | Pending |
| DEMO-01 | Phase 5 | Pending |
| DEMO-02 | Phase 5 | Pending |
| REL-01 | Phase 5 | Pending |
| REL-02 | Phase 5 | Pending |

**Coverage:** 19/19 v1 requirements mapped exactly once.

---
*Requirements initialized 2026-07-12.*
