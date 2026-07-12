# fn-3 Vercel demo-only frontend deployment

## Goal & Context

Vercel is not a real deployment target for MioBridge — the real target is
self-hosted (Linux + the fn-2 CLI). Vercel's role is reduced to a public demo:
a display-only deployment of the frontend so people can see the dashboard UI
without installing anything. Reconfigure the Vercel deployment (via Vercel CLI)
so it deploys only the frontend part, in a demo/showcase mode.

## Architecture & Data Models

- Deploy scope: only `frontend/` (Vercel project root or CLI `--cwd`
  configuration pointed at `frontend/`).
- Demo mode: the deployment must not depend on a live backend/runtime state
  (`~/.config/miobridge` does not exist on Vercel). Options to resolve during
  planning: mock/fixture data behind an env flag (e.g. `MIOBRIDGE_DEMO=1`),
  static sample artifacts, or disabling mutating actions in the UI.
- Configuration lives in checked-in files (`vercel.json` / project settings
  documented) so the demo is reproducible via `vercel` CLI, not hand-configured
  in the web console.

## API Contracts

- Demo deployment renders the dashboard pages without server errors.
- Mutating operations (subscription update, node deploy, config edit) are
  disabled or clearly no-op in demo mode — the demo must never look like a
  functioning converter endpoint.
- Compatibility URLs on the demo either serve sample artifacts or a clear
  "demo only" response — never stale-but-plausible real output.

## Edge Cases & Constraints

- No secrets (HMAC keys, SSH credentials) may be present in the demo project.
- Do not invest in Vercel statefulness (KV, cron, blob) — throwaway demo only.
- Demo constraints must not leak complexity into the core codebase: prefer a
  thin env-flag seam over parallel demo implementations.

## Acceptance Criteria

- **R1:** `vercel` CLI deploys the frontend-only demo reproducibly from checked-in configuration.
- **R2:** The demo renders the main dashboard views with sample data and no runtime backend.
- **R3:** All mutating actions are disabled or no-op in demo mode, visibly labeled as demo.
- **R4:** No secrets or real node data exist in the Vercel project.

## Boundaries

Out of scope:
- Any production/stateful use of Vercel.
- The self-hosted deployment path (fn-2 owns that).
- Frontend rewrite (fn-4) — demo deploys the current Next.js frontend; revisit
  the Vercel setup only if fn-4 changes the build output.

## Decision Context

Existing standing decision (user memory, 2026): "Vercel is demo-only — don't
invest in Vercel statefulness; real target is self-hosted." This spec is the
implementation of that decision. Independent of fn-1/fn-2 ordering — can be
done any time; loosely coupled to fn-4 (a Vite SPA would make the demo even
simpler, but waiting is not required).
