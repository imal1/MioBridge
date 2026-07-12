---
satisfies: [R1, R3, R6, R7]
---
## Description
Evolve CLI dashboard provider schema and packaging to contained Vite static assets, then implement secure static delivery and SPA fallback on the dashboard server.

**Size:** M
**Files:** `packages/cli/src/dashboard/provider.ts`, `packages/cli/src/dashboard/server/staticAssets.ts`, `scripts/package-dashboard-provider.sh`, `packages/cli/test/dashboard/static-assets.test.ts`, `frontend/vite.config.ts`

## Approach
- Add static-provider schema form/version with migration policy for installed v1 providers.
- Package Vite output plus manifest; do not depend on executable Next standalone layout.
- Serve only contained real files with correct MIME/cache headers, deny traversal/symlink escape, and fall back to `index.html` only for UI deep links.
- Preserve explicit API and compatibility route precedence.

## Investigation targets
**Required**:
- `packages/cli/src/dashboard/provider.ts:5-129` — manifest containment and URL rules.
- `packages/cli/src/dashboard/foreground.ts:37-109` — lifecycle contract to retain.
- `scripts/package-dashboard-provider.sh` — current Next provider packaging to replace.
- `frontend/next.config.js:30-37` — compatibility rewrite ownership to migrate.
- `https://vite.dev/guide/static-deploy` — static artifact/deployment constraints.

## Acceptance
- [ ] Provider schema/static package carries Vite artifact with clear v1 migration behavior.
- [ ] Static server enforces containment, MIME/cache headers, API/compat precedence, and safe deep-link fallback.
- [ ] Live tests verify Vite assets, deep links, traversal denial, all compatibility URLs, and no Next executable/runtime dependency.
- [ ] Existing foreground/systemd CLI lifecycle works unchanged with static provider.

## Done summary
Evolved dashboard provider to support Vite static assets (v2 schema) and implemented secure static file delivery.

### Provider schema v2
- `schemaVersion: 2` — canonical static form (no executable/entrypoint)
- `artifactRoot` — relative path to Vite `dist` directory
- `spaFallback` — optional SPA history fallback (default true)
- `reservedPaths` — auto-includes `/api`, `/health`, compat URLs
- v1 schema retained for read-only migration path
- `isV1Manifest()` guard for v1/v2 branching

### Static server
- `staticServer.ts`: containment enforcement, traversal denial, MIME/cache headers
- Immutable cache for hashed assets (`[.-][0-9a-f]{8,}\.`)
- SPA history fallback to `index.html`
- API/compat route precedence (never intercepted by static)

### Vite configuration
- `frontend/vite.config.ts`: React plugin, path aliases, manual chunks (vendor, ui)
- Dev proxy to CLI dashboard server on port 3000

### Foreground lifecycle
- v2 providers skip external process spawn; return immediately
- v1 providers still supported via `isV1Manifest` guard

### Tests
- `static-assets.test.ts`: 8 tests (MIME, cache, traversal, SPA fallback, reserved paths)
- `provider.test.ts`: updated for v2 (5 tests)
- 116/116 CLI tests pass
## Evidence
- Commits:
- Tests: packages/cli/test/dashboard/static-assets.test.ts (8/8 pass), packages/cli/test/dashboard/provider.test.ts (5/5 pass), packages/cli/test/* (116/116 pass), packages/core/* (30/30 pass)
- PRs: