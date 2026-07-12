---
satisfies: [R4, R6]
---
## Description
Implement idempotent persistent dashboard `start|stop|status` using a systemd user unit generated from the provider contract, including lingering guidance, journal discovery, and conflict checks.

**Size:** M
**Files:** `packages/cli/src/dashboard/systemd.ts`, `packages/cli/src/dashboard/commands.ts`, `packages/cli/src/command.ts`, `packages/cli/test/dashboard/systemd.test.ts`

## Approach
- Render a hardened user unit under the user config directory using a stable CLI launcher and provider manifest rather than a Next path.
- Reuse `dashboardManifestPath()` (`<baseDir>/dist/dashboard/provider.json`) and launch through `miobridge dashboard foreground`; keep systemd logic outside `DashboardForegroundService` and do not parse or execute provider paths independently.
- Probe user-systemd availability, lingering, legacy system-wide service, and port occupancy before start.
- Treat already-running/already-stopped as exit-0 states; distinguish unsupported/broken service through human and JSON status.
- Any lingering enablement requiring privilege must be explicitly confirmed and provide manual guidance when unavailable.
- Route `dashboard start|stop|status` through the established `runCli()` output/exit-code contract; preserve decoration-free JSON output alongside the existing headless `status --json` behavior.

<!-- Updated by plan-sync: fn-2-miobridge-cli-with-guided-linux-install.1 established runCli as the output and exit-code boundary -->
<!-- Updated by plan-sync: fn-2-miobridge-cli-with-guided-linux-install.4 established dashboardManifestPath/DashboardForegroundService and dashboard foreground as the provider lifecycle seams -->

## Investigation targets
**Required**:
- `scripts/manage.sh:107-162` — legacy root unit behavior to avoid copying.
- `packages/cli/src/command.ts` — actual dispatcher, JSON purity, and error-to-exit mapping contract.
- `packages/cli/src/dashboard/foreground.ts` — implemented provider discovery path, foreground environment (`HOSTNAME`, `PORT`, `MIOBRIDGE_CONFIG_DIR`, `CONFIG_FILE`), signal forwarding, and child exit-code contract to wrap rather than duplicate.
- `packages/cli/src/dashboard/provider.ts` — schema-v1 manifest validation and lexical/realpath containment guarantees that daemon commands must preserve.
- `packages/cli/test/dashboard/foreground.test.ts` — existing injected lifecycle and real four-URL foreground smoke harness to extend for daemon integration.
- `scripts/lib/service.sh` — existing systemctl parsing patterns.
- `scripts/server-deploy.sh:124-140` — current restart/health behavior.
- `.Codex/memory/deployment-flow.md:10-27` — deployment and privilege constraints.
- `.Codex/memory/bug-fixes.md:53-66` — non-root sudo and atomic replacement rules.

## Acceptance
- [ ] Generated unit uses safe escaping, stable paths, restart policy, explicit environment, and no guessed PID.
- [ ] start/stop/status are idempotent with stable JSON/human states and journal guidance.
- [ ] Unsupported user-systemd, disabled lingering, legacy service, occupied port, and provider failure are actionable and tested.
- [ ] Linux systemd integration evidence proves the service survives session exit and is discoverable after reconnect.

## Done summary
Implemented a framework-neutral systemd user dashboard lifecycle with a hardened, safely escaped unit; idempotent start/stop/status; explicit linger confirmation and manual guidance; legacy-service, occupied-port, unsupported-manager, and provider-failure diagnostics; human/JSON CLI output; and injected unit/command tests.
## Evidence
- Commits: 939ad05
- Tests: bun run cli:typecheck, bun run cli:test (7 files, 37 tests), bun run --cwd packages/cli test -- --run test/dashboard/systemd.test.ts test/command.test.ts (2 files, 14 tests), git diff --check
- PRs: