# fn-4 Migrate dashboard frontend from Next SSR to Vite SPA

## Goal & Context

Once the backend core lives in `packages/core` (fn-1) and the CLI is the
primary runtime (fn-2), Next.js SSR stops paying its way: the dashboard's only
remaining job is to be a pluggable web UI over the core's API. Replacing the
Next Pages Router SSR app with a Vite-built SPA (or similar lightweight
frontend) makes the dashboard a static asset bundle the CLI can serve, keeps
the "web is optional" promise, and removes the Node/Next standalone build from
the deployment story.

This is a direction-holder spec: it records intent and constraints so fn-1/fn-2
decisions don't foreclose it. Flesh out via /flow-next:interview or planning
when fn-1 and fn-2 have landed.

## Architecture & Data Models

- Target shape (to be validated in planning): Vite SPA consuming a JSON API
  served by the core (via the CLI's dashboard server), replacing
  getServerSideProps direct service calls.
- The API surface that today exists as Next API routes becomes the contract
  between core and any frontend; fn-1's thin-route discipline is the
  preparation for this.
- Compatibility URLs (`/subscription.txt` etc.) move from Next rewrites to the
  dashboard server layer.

## API Contracts

To be defined in planning. Hard requirement: the SPA talks to the same core
services via HTTP; no business logic in the frontend.

## Edge Cases & Constraints

- UI stack stays on the current design system (shadcn/ui, Iconify, Botanical
  Garden tokens, Mio Garden task pages) — this is a runtime migration, not a
  redesign.
- Must not regress the compatibility URLs or the Agent/HMAC flows.
- The CLI (fn-2) must be able to serve the built SPA as static assets.

## Acceptance Criteria

- **R1:** Dashboard runs as a Vite-built static bundle served by the miobridge dashboard server, with no Next.js runtime.
- **R2:** All current dashboard functionality works over the HTTP API against `@miobridge/core`.
- **R3:** Compatibility URLs keep working.

## Boundaries

Out of scope until planning: exact data-fetching library, routing, auth.
Explicitly not a visual redesign. Do not start before fn-1 and fn-2 are done.

## Decision Context

User direction (2026-07-12): "可插拔的web不会让人感到项目过重" — the web UI must be
pluggable and lightweight; SSR coupling contradicts that. Kept as a spec now so
fn-1 (API boundary) and fn-2 (dashboard serving) are designed with this end
state in mind.
