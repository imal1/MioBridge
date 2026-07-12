---
satisfies: [R4, R6]
---
## Description
Implement idempotent persistent dashboard `start|stop|status` using a systemd user unit generated from the provider contract, including lingering guidance, journal discovery, and conflict checks.

**Size:** M
**Files:** `packages/cli/src/dashboard/systemd.ts`, `packages/cli/src/dashboard/commands.ts`, `packages/cli/test/dashboard/systemd.test.ts`

## Approach
- Render a hardened user unit under the user config directory using a stable CLI launcher and provider manifest rather than a Next path.
- Probe user-systemd availability, lingering, legacy system-wide service, and port occupancy before start.
- Treat already-running/already-stopped as exit-0 states; distinguish unsupported/broken service through human and JSON status.
- Any lingering enablement requiring privilege must be explicitly confirmed and provide manual guidance when unavailable.

## Investigation targets
**Required**:
- `scripts/manage.sh:107-162` — legacy root unit behavior to avoid copying.
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
TBD

## Evidence
- Commits:
- Tests:
- PRs:
