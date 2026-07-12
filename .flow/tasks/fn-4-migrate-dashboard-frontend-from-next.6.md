---
satisfies: [R1, R2, R3, R4, R5, R6, R7]
---
## Description
Remove Next runtime/build artifacts after parity, harden Vite static release and Vercel configuration, run end-to-end dashboard lifecycle checks, and update docs/memory for the final architecture.

**Size:** M
**Files:** `frontend/package.json`, `frontend/next.config.js`, `frontend/vite.config.ts`, `.github/workflows/**`, `scripts/**`, `README.md`, `README.zh-CN.md`, `docs/**`, `.Codex/memory/**`

## Approach
- Remove Next-specific runtime/dependencies/commands only after static server + SPA parity gates pass.
- Make Vite `dist` both provider artifact and Vercel static deployment output; do not use Vite preview as production server.
- Preserve CLI headless commands and provider/systemd behavior after dashboard removal/upgrade.
- Update tests, CI, release, Vercel config/docs, and project memory from observed final behavior.

## Investigation targets
**Required**:
- `frontend/package.json:7-64` — current Next dependencies/scripts to replace.
- `frontend/next.config.js` — delete only after routes/static server own its responsibilities.
- `.github/workflows/ci.yml` — current standalone gates to replace with Vite/static server gates.
- `.github/workflows/cli-systemd-e2e.yml` — provider lifecycle gate.
- `scripts/package-dashboard-provider.sh` — final provider artifact packaging.
- `README.md`, `README.zh-CN.md`, `docs/CLI.md`, `docs/CI-CD.md`, `docs/DEPLOYMENT.md` — stale Next wording.

## Acceptance
- [ ] Production/provider artifact contains Vite static bundle and CLI server only, with no Next dependency/runtime/build output.
- [ ] Full CI verifies contracts, static security/precedence, Vite bundle boundary, browser flows, HMAC/SSE, four URLs, compiled CLI foreground/systemd lifecycle, and dashboard removal.
- [ ] Vercel configuration deploys the static Vite dashboard intentionally; fn-3 receives a documented final artifact contract.
- [ ] Docs and matching memory accurately describe static dashboard, server/API ownership, Vercel/CLI boundaries, and no visual redesign.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
