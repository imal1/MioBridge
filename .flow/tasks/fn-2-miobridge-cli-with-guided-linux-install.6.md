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
- Reuse the implemented `DependencySetupService` injection seam and `packages/cli/test/setup/setup.test.ts` harness when extending dependency coverage; keep real Node side effects in `createNodeSetupAdapters()`.
- Preserve existing core/frontend/Agent/standalone gates and Vercel production documentation.
- Document install/upgrade/uninstall, data retention, Linux/systemd scope, dependency purpose/origin, logs, troubleshooting, and fn-4 provider replaceability.
- Preserve the established root gates `cli:test`, `cli:typecheck`, and `cli:build`, including the compiled external-cwd `status --json` headless probe in `packages/cli/test/headless.test.ts`.
- Extend rather than replace the implemented `cli:release` / `build:release` pipeline and `packages/cli/test/release/release.test.ts` contracts for archive permissions, x64/arm64 mapping, checksum rollback, external-cwd install, and data-preserving uninstall.
- Retain `packages/cli/test/dashboard/provider.test.ts` path/symlink/schema contracts and `foreground.test.ts` real HTTP smoke for `/health`, `/subscription.txt`, `/clash.yaml`, and `/raw.txt`; package the current implementation through `scripts/package-dashboard-provider.sh` without making Next a CLI dependency.
- Extend the implemented `DashboardSystemdService`/`SystemdAdapters` contract with a real Linux user-systemd reconnect gate: use the generated `miobridge-dashboard.service`, explicitly verify linger, logout/reconnect discovery, idempotent start/stop/status, decoration-free `dashboard status --json`, and provider failure journal guidance.
- Keep VM/CI privilege setup outside CLI behavior: tests may provision a disposable user and enable linger explicitly, but production CLI must retain the confirmation/manual-guidance boundary and must not introduce a root system unit or PID-file fallback.

<!-- Updated by plan-sync: fn-2-miobridge-cli-with-guided-linux-install.1 established the CLI gate names and external-cwd test location -->
<!-- Updated by plan-sync: fn-2-miobridge-cli-with-guided-linux-install.2 established DependencySetupService/createNodeSetupAdapters and setup.test.ts as the dependency safety seams -->
<!-- Updated by plan-sync: fn-2-miobridge-cli-with-guided-linux-install.3 established release archive, installer transaction, and GitHub Release workflow contracts -->
<!-- Updated by plan-sync: fn-2-miobridge-cli-with-guided-linux-install.4 established the schema-v1 provider, foreground lifecycle, packaging script, and four-URL smoke harness -->
<!-- Updated by plan-sync: fn-2-miobridge-cli-with-guided-linux-install.5 established DashboardSystemdService/SystemdAdapters, miobridge-dashboard.service, daemon JSON states, and injected lifecycle tests; real logout/reconnect evidence remains owned by this task -->

## Investigation targets
**Required**:
- `.github/workflows/ci.yml` — current complete regression gates.
- `packages/cli/test/headless.test.ts` — existing compiled external-cwd and injected-base headless coverage to retain and extend.
- `packages/cli/test/setup/setup.test.ts` — implemented origin, refusal, checksum, failure/redaction, unsupported-platform, and atomic rollback coverage to retain in CI.
- `packages/cli/src/setup/catalog.ts` — pinned x64/arm64 dependency versions and verified SHA256 values that release/security documentation must match.
- `scripts/package-cli-release.sh` and `scripts/install-cli.sh` — implemented deterministic archive names, SHA256SUMS, architecture selection, atomic replacement, repository/install-dir overrides, and CLI-only uninstall behavior.
- `packages/cli/test/release/release.test.ts` — implemented archive permissions, both architecture mappings, checksum rollback, external-cwd, and data retention coverage to retain in CI.
- `.github/workflows/release.yml` — implemented tag-driven dual-architecture packaging and GitHub Release upload flow to harden without duplicating.
- `packages/cli/src/dashboard/provider.ts` and `packages/cli/src/dashboard/foreground.ts` — implemented schema-v1 provider validation/discovery and framework-neutral lifecycle contract to document and retain.
- `packages/cli/test/dashboard/provider.test.ts` and `packages/cli/test/dashboard/foreground.test.ts` — implemented traversal/symlink/missing-provider tests plus live compatibility URL smoke coverage to wire into Linux gates.
- `scripts/package-dashboard-provider.sh` — current Next standalone provider packaging contract and `provider.json` layout that fn-4 may replace behind the same CLI lifecycle.
- `packages/cli/src/dashboard/systemd.ts` — implemented user-unit renderer, `DashboardSystemdService`, `SystemdAdapters`, linger/manual guidance, legacy-service and port conflict probes, journal command, and stable `running|stopped|unsupported|broken` status contract.
- `packages/cli/src/dashboard/commands.ts` and `packages/cli/src/command.ts` — implemented human/JSON daemon formatting and `dashboard start|stop|status [--json]` dispatch/exit-code boundary to preserve in integration tests and docs.
- `packages/cli/test/dashboard/systemd.test.ts` — injected coverage for safe escaping, idempotency, unsupported user manager, linger refusal/failure, conflicts, provider startup failure, and broken status; add Linux session/reconnect evidence rather than duplicating these unit cases.
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
Added CLI archive/provider CI gates, disposable Linux user-systemd E2E coverage, EN/ZH operations documentation, and durable CI/architecture memory.
## Evidence
- Commits:
- Tests: bun run cli:typecheck, bun run cli:test (38 passed), MIOBRIDGE_RELEASE_VERSION=0.0.0-local bun run cli:release + archive inspection, bun run build + package-dashboard-provider smoke, bun run core:test (30 passed), bun run --cwd frontend test (325 passed), bun run --cwd agent test (29 passed), YAML parse and bash syntax checks
- PRs: