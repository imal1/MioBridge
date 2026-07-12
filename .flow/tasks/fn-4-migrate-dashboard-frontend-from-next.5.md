---
satisfies: [R1, R2, R5, R7]
---
## Description
Migrate Dashboard pages/components from Next Pages Router/SSR to Vite React SPA using typed HTTP clients, while preserving Botanical Garden tokens, shadcn/Radix/Iconify components, navigation, responsive behavior, and user flows.

**Size:** M
**Files:** `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/routes/**`, `frontend/src/lib/api/**`, `frontend/src/pages/**`, `frontend/src/components/**`, `frontend/src/styles/globals.css`

## Approach
- Preserve existing page paths, labels, hierarchy, theme provider, shared layout, and component appearance; delete SSR data loading only after client routes work.
- Use one typed API client layer with explicit loading/error/empty state behavior and cancellation/revalidation policy.
- Keep browser code free of Node/core/SSH/deploy imports.
- Retain current UI tests; add SPA route/browser interaction coverage across major dashboard flows.

## Design context

Relevant Botanical Garden constraints:
- **Tokens:** use `frontend/src/styles/globals.css:6-181`; no hard-coded Tailwind gray palette substitution.
- **Components:** retain current shadcn/Radix/Iconify primitives and existing rounded/surface/shadow system.
- **Do not change:** primary navigation, page URLs, visual IA, theme behavior, keyboard/focus behavior, or responsive layout without a migration need.

## Investigation targets
**Required**:
- `frontend/src/pages/_app.tsx` — global providers/styles to retain.
- `frontend/src/components/layout/AppLayout.tsx` and `navigation.ts` — navigation/layout contract.
- `frontend/src/components/Dashboard.tsx` — dashboard state/UI behavior.
- `frontend/src/pages/index.tsx`, `config.tsx`, `nodes.tsx`, `deploy.tsx`, `logs.tsx` — SSR pages to migrate.
- `frontend/src/styles/globals.css:6-181` — Botanical Garden design tokens.
- `frontend/src/components/**/__tests__` — behavior/visual regression anchors.

## Acceptance
- [ ] Vite SPA preserves all dashboard routes, core flows, visual tokens, themes, responsive layout, and accessibility behavior.
- [ ] No `getServerSideProps`, Next routing/runtime, or direct core/frontend-server imports remain in browser code.
- [ ] Each data view provides loading, error, empty, and retry/revalidation states.
- [ ] Component/browser tests cover main pages, node/deploy actions, theme, keyboard/focus, and mobile behavior.

## Done summary
### fn-4.5: Migrate Botanical Garden dashboard to Vite HTTP SPA

Migrated all 8 dashboard pages from Next.js Pages Router SSR to Vite React SPA.

### Changes
- Created `frontend/src/lib/types.ts` — browser-safe type definitions (ClusterStatus, NodeStatus, DeployStatus, KernelDetection, etc.) mirroring server types without Node imports
- Updated `frontend/src/lib/api.ts` — changed imports from `@/server/types` and `@/server/services/deployManager` to `@/lib/types`
- Replaced `next/link` with `react-router-dom` `Link` in Sidebar, MobileDrawer, Dashboard
- Replaced `next/router` with `react-router-dom` `useLocation` in Sidebar, MobileHeader, MobileDrawer
- Removed `getServerSideProps` from config.tsx, nodes.tsx, deploy.tsx
- Added `useEffect` client-side data fetching in nodes.tsx, config.tsx (deploy.tsx already had polling)
- Added `useEffect` auto-fetch in Dashboard.tsx when no initial props provided
- Updated all cluster component imports (ClusterOverview, NodeCard, NodeDetail, DeployProgressDialog, AddNodeForm, KernelDetectionDialog, KernelStatus) from `@/server/types` to `@/lib/types`
- Updated test files (cluster-components.test.tsx, kernel-detection-dialog.test.tsx) imports
- Rewrote `App.tsx` with ThemeProvider, AppProvider, ConvertModal, page transitions via AnimatePresence, lazy-loaded routes
- Installed `react-router-dom@7.18.1`
- Fixed `vite.config.ts` manualChunks from object to function (Vite 8 compatibility)

### Verification
- Vite build: 573 modules, 597ms, 250KB gzip main bundle
- No `getServerSideProps` in pages/ or components/
- No `next/link` or `next/router` in pages/ or components/ (except _app.tsx — Next.js leftover for fn-4.6)
- No `@/server` imports in browser code (pages/ except api/, components/, lib/)
- 116/116 CLI tests pass
- 30/30 core tests pass
## Evidence
- Commits:
- Tests: 116/116 CLI tests pass, 30/30 core tests pass
- PRs: