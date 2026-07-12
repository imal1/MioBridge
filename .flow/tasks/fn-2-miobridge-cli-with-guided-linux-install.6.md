---
satisfies: [R1, R2, R3, R4, R5, R6]
---
## Description
Harden the complete Linux CLI/release/dashboard story in CI and documentation: fresh install, headless core, dependency safety, systemd persistence, live URLs, upgrade rollback, and optional dashboard removal.

**Size:** M
**Files:** `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `README.md`, `README.zh-CN.md`, `CONTRIBUTING.md`, `docs/**`, `.Codex/memory/**`

## Approach
- Add fast unit/contracts to ordinary CI and release/VM-style gates for compiled binaries and user-systemd behavior.
- Exercise release installer from an empty directory, CLI update/status without dashboard, dependency confirmation refusal, checksum rollback, provider foreground, and daemon reconnect.
- Preserve existing core/frontend/Agent/standalone gates and Vercel production documentation.
- Document install/upgrade/uninstall, data retention, Linux/systemd scope, dependency purpose/origin, logs, troubleshooting, and fn-4 provider replaceability.
- Preserve the established root gates `cli:test`, `cli:typecheck`, and `cli:build`, including the compiled external-cwd `status --json` headless probe in `packages/cli/test/headless.test.ts`.

<!-- Updated by plan-sync: fn-2-miobridge-cli-with-guided-linux-install.1 established the CLI gate names and external-cwd test location -->

## Investigation targets
**Required**:
- `.github/workflows/ci.yml` — current complete regression gates.
- `packages/cli/test/headless.test.ts` — existing compiled external-cwd and injected-base headless coverage to retain and extend.
- `README.md:40-60,123-152` — commands, routes, and architecture.
- `README.zh-CN.md:40-58,125-145` — matching Chinese documentation.
- `CONTRIBUTING.md:5-40` — contributor gates.
- `docs/CI-CD.md` and `docs/DEPLOYMENT.md` — release/production separation.
- `.Codex/memory/ci-cd-pipeline.md` — durable gate record.

## Acceptance
- [ ] CI/release gates cover both Linux architectures, installer checksum/rollback, CLI headless execution, and provider artifacts.
- [ ] Linux systemd evidence covers linger/reconnect, idempotent lifecycle, and live compatibility URLs.
- [ ] Existing core/frontend/Agent/build gates remain green and dashboard removal leaves CLI/config/data functional.
- [ ] English/Chinese docs, contributor guidance, troubleshooting, and matching memory files describe the actual implementation and boundaries.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
