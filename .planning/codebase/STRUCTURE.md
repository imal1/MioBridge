# Codebase Structure

**Analysis Date:** 2026-07-11

## Directory Layout

```text
MioBridge/
├── frontend/                    # Active Next.js full-stack service and dashboard
│   ├── src/components/          # React feature, layout, shared, and UI components
│   ├── src/context/             # Browser-wide React state
│   ├── src/lib/                 # Browser API clients, hooks, and UI utilities
│   ├── src/pages/               # Pages Router UI, SSR loaders, and API routes
│   ├── src/server/              # Framework-independent backend logic and Node integrations
│   ├── src/styles/              # Botanical Garden global design tokens/styles
│   └── public/                  # Static assets copied beside standalone output when present
├── agent/                       # Independently compiled child-node HTTP Agent
│   └── src/                     # Agent server, config, HMAC, handlers, and Bun tests
├── scripts/                     # Installation, build, deployment, E2E, and service scripts
│   └── lib/                     # Reusable shell modules
├── config/                      # systemd and nginx deployment templates
├── docs/                        # Deployment, CI/CD, plans, and specifications
├── doc/design/                  # Product redesign material and visual references
├── .Codex/memory/               # Short project decisions and learned conventions
├── .planning/codebase/          # Generated GSD codebase map
├── package.json                 # Root Bun workspace and command facade
├── config.yaml.example          # Example main-node runtime configuration
├── manage.sh                    # Compatibility wrapper for scripts/manage.sh
├── AGENTS.md                    # Project-specific agent architecture rules
└── README.md                    # Primary user documentation
```

## Directory Purposes

**`frontend/`:**
- Purpose: Own the only full-stack application deployed for the main node and dashboard.
- Contains: TypeScript/TSX application code, Next.js configuration, Vitest setup, CSS/design configuration, and package metadata.
- Key files: `frontend/next.config.js`, `frontend/package.json`, `frontend/src/pages/_app.tsx`, `frontend/src/instrumentation.ts`.
- Subdirectories: `frontend/src/pages/` for routes, `frontend/src/server/` for backend logic, `frontend/src/components/` for UI, and `frontend/src/lib/` for browser helpers.

**`frontend/src/pages/`:**
- Purpose: Define Pages Router entry points and server-rendered views.
- Contains: Top-level `*.tsx` views, `_app.tsx`, and the nested API filesystem router.
- Key files: `frontend/src/pages/index.tsx`, `frontend/src/pages/nodes.tsx`, `frontend/src/pages/config.tsx`, `frontend/src/pages/deploy.tsx`.
- Subdirectories: `frontend/src/pages/api/` groups subscription, YAML, cluster, deployment, kernel, Agent, log, status, and file endpoints.

**`frontend/src/pages/api/`:**
- Purpose: Provide thin HTTP adapters around backend services.
- Contains: One default Next handler per route, boundary validation, HMAC checks, JSON response mapping, SSE, and file delivery.
- Key files: `frontend/src/pages/api/update.ts`, `frontend/src/pages/api/file/[name].ts`, `frontend/src/pages/api/cluster/events.ts`, `frontend/src/pages/api/cluster/nodes.ts`.
- Subdirectories: `cluster/` for main/child orchestration, `yaml/` for YAML operations, `diagnose/` for health diagnostics, and `file/` for generated artifacts.

**`frontend/src/server/`:**
- Purpose: Hold all Node-only and framework-independent backend implementation.
- Contains: Domain services, shared types, config/runtime path resolution, middleware, logging, and command helpers.
- Key files: `frontend/src/server/runtimePaths.ts`, `frontend/src/server/types/index.ts`, `frontend/src/server/services/mioBridgeService.ts`, `frontend/src/server/services/nodeManager.ts`.
- Subdirectories: `services/`, `services/adapters/`, `middleware/`, `config/`, `cli/`, `types/`, `utils/`, and colocated `__tests__/` directories.

**`frontend/src/server/services/`:**
- Purpose: Implement core subscription, kernel, cluster, persistence, and deployment behavior.
- Contains: `XxxService`/manager modules and focused supporting modules.
- Key files: `mioBridgeService.ts`, `nodeManager.ts`, `deployManager.ts`, `mihomoService.ts`, `singBoxService.ts`, `yamlService.ts`, `stateStore.ts`, `deployProgressStore.ts`, `proxySources.ts`.
- Subdirectories: `adapters/` provides the common kernel integration boundary; `__tests__/` contains service-level tests.

**`frontend/src/components/`:**
- Purpose: Compose the dashboard's visual interface from domain components and reusable primitives.
- Contains: PascalCase React components and lowercase shadcn-style UI primitives.
- Key files: `frontend/src/components/Dashboard.tsx`, `frontend/src/components/ConvertModal.tsx`, `frontend/src/components/ThemeProvider.tsx`.
- Subdirectories: `cluster/` for node workflows, `layout/` for application chrome, `shared/` for domain-neutral presentation, and `ui/` for base controls.

**`frontend/src/lib/` and `frontend/src/context/`:**
- Purpose: Provide browser-side integration and state utilities.
- Contains: Typed API calls, cluster SSE hook, configuration hook, class-name merging, design tokens, and global application context.
- Key files: `frontend/src/lib/api.ts`, `frontend/src/lib/useClusterSSE.ts`, `frontend/src/lib/configApi.ts`, `frontend/src/context/AppContext.tsx`.
- Subdirectories: `frontend/src/lib/__tests__/` contains browser-helper tests.

**`agent/`:**
- Purpose: Build the lightweight binary deployed to child Linux nodes.
- Contains: A minimal standard-library HTTP server, config loader, HMAC verification, endpoint handlers, tests, and Bun build metadata.
- Key files: `agent/src/server.ts`, `agent/src/config.ts`, `agent/src/hmac.ts`, `agent/package.json`, `agent/agent.yaml.example`.
- Subdirectories: `agent/src/handlers/` contains endpoint-specific logic; `agent/src/__tests__/` contains Bun tests.

**`scripts/`:**
- Purpose: Install, build, package, deploy, validate, and uninstall MioBridge.
- Contains: Bash entry points plus small JavaScript E2E/binary-preparation tools.
- Key files: `scripts/manage.sh`, `scripts/install.sh`, `scripts/prepare-standalone.sh`, `scripts/server-deploy.sh`, `scripts/build-agent.sh`.
- Subdirectories: `scripts/lib/` separates build, config, core UI, dependency installation, service, and system functions.

**`config/`:**
- Purpose: Store templates consumed by installation/deployment scripts.
- Contains: systemd and nginx configuration templates.
- Key files: `config/miobridge.service.template`, `config/nginx.conf.template`.
- Subdirectories: None.

**`docs/` and `doc/design/`:**
- Purpose: Keep operator documentation separate from product/design reference material.
- Contains: Deployment/CI documentation, dated implementation plans/specs, HTML mockups, PRDs, proposals, and reference images.
- Key files: `docs/DEPLOYMENT.md`, `docs/CI-CD.md`, `doc/design/product_redesign_prd.md`, `doc/design/design_mockups.html`.
- Subdirectories: `docs/superpowers/plans/`, `docs/superpowers/specs/`, and `doc/design/images/`.

## Key File Locations

**Entry Points:**
- `frontend/src/pages/_app.tsx`: Dashboard React application wrapper, providers, layout, transitions, and global styles.
- `frontend/src/pages/index.tsx`: Dashboard home route and direct service-based SSR loader.
- `frontend/src/instrumentation.ts`: Next startup hook with the required Node-runtime guard.
- `frontend/src/instrumentation-node.ts`: Node startup initialization and subscription cron registration.
- `agent/src/server.ts`: Child-node Agent process entry and manual HTTP router.
- `scripts/manage.sh`: Unified source-tree management command.
- `scripts/install.sh`: Installation entry point.
- `manage.sh`: Root compatibility forwarder to `scripts/manage.sh`.

**Configuration:**
- `package.json`: Root Bun workspace scripts and repository metadata.
- `frontend/package.json`: Active application dependencies and dev/build/test commands.
- `frontend/next.config.js`: Standalone/Vercel build behavior, tracing, Node packages, compatibility rewrites, and build metadata.
- `frontend/tsconfig.json`: Active frontend/server TypeScript project and `@/*` alias.
- `frontend/vitest.config.ts`: Frontend/server Vitest configuration.
- `frontend/tailwind.config.js`: UI token and Tailwind integration.
- `frontend/src/styles/globals.css`: Botanical Garden design tokens; use these variables instead of component hard-coded colors.
- `config.yaml.example`: User-facing runtime configuration example; installed config belongs at `~/.config/miobridge/config.yaml`.
- `agent/agent.yaml.example`: Child Agent configuration example.
- `oxlint.json`: Repository lint configuration.

**Core Logic:**
- `frontend/src/server/services/mioBridgeService.ts`: Subscription aggregation, extraction, conversion, file generation, backup, and status.
- `frontend/src/server/services/nodeManager.ts`: Cluster node persistence, remote Agent communication, source collection, and status lifecycle.
- `frontend/src/server/services/deployManager.ts`: SSH-based kernel detection/install and Agent deployment/control.
- `frontend/src/server/services/mihomoService.ts`: Mihomo binary discovery, health/version checks, and conversion.
- `frontend/src/server/services/stateStore.ts`: File/Redis persistence strategy and locking.
- `frontend/src/server/services/adapters/`: Kernel-specific source/config adapters.
- `frontend/src/server/types/index.ts`: Shared server/domain contracts and validators.
- `frontend/src/pages/api/`: HTTP exposure for service behavior.

**Testing:**
- `frontend/src/server/**/__tests__/`: Backend service, API behavior, middleware, types, and CLI tests.
- `frontend/src/components/**/__tests__/`: React component and cluster workflow tests.
- `frontend/src/lib/__tests__/`: Browser API and hook tests.
- `frontend/src/__tests__/instrumentation-node.test.ts`: Startup behavior test.
- `frontend/src/test-setup.ts`: Vitest shared setup.
- `agent/src/__tests__/`: Bun tests for Agent configuration and handlers.
- `scripts/e2e-browser.mjs`: Browser-level E2E entry.
- `scripts/e2e-distributed.sh`: Distributed main/child integration entry.

**Documentation:**
- `README.md`: Primary user-facing overview and usage.
- `README.zh-CN.md`: Chinese user documentation.
- `TROUBLESHOOTING.md`: Operator troubleshooting guide.
- `docs/DEPLOYMENT.md`: Deployment procedures.
- `docs/CI-CD.md`: CI/CD design and operation.
- `AGENTS.md`: Concise authoritative architecture and development rules for agents.
- `.Codex/memory/`: Topic-specific project knowledge updated only when a change matches its memory category.

## Naming Conventions

**Files:**
- Use PascalCase `.tsx` for React feature/shared/layout components: `frontend/src/components/cluster/NodeCard.tsx`.
- Use lowercase `.tsx` for shadcn-style primitives: `frontend/src/components/ui/button.tsx`.
- Use camelCase `.ts` for services and utility modules: `frontend/src/server/services/deployManager.ts` and `frontend/src/lib/useClusterSSE.ts`.
- Use lowercase or kebab-case route segments matching public URLs: `frontend/src/pages/api/cluster/kernel/detect.ts`.
- Use `*.test.ts`/`*.test.tsx` inside `__tests__/` for automated tests.
- Use kebab-case `.sh` for operational scripts and simple domain names for `scripts/lib/*.sh` modules.
- Use UPPERCASE `.md` for repository governance/reference files and generated codebase maps.

**Directories:**
- Use lowercase domain names for application directories: `services/`, `components/`, `cluster/`, `middleware/`.
- Use `__tests__/` colocated with the layer or feature being tested.
- Nest API directories to match URL structure exactly; dynamic parameters use Next brackets such as `frontend/src/pages/api/file/[name].ts`.
- Use plural collection directories where the repository already does so: `components/`, `services/`, `handlers/`, `scripts/`, `docs/`.

**Special Patterns:**
- `XxxService.getInstance()` is the standard service access pattern; keep framework request types out of `frontend/src/server/services/**`.
- `index.ts` is used for central exports/config/type surfaces such as `frontend/src/server/types/index.ts` and `frontend/src/server/config/index.ts`, not as a blanket barrel convention.
- Node-only startup logic is split between guarded `frontend/src/instrumentation.ts` and implementation-only `frontend/src/instrumentation-node.ts`.
- Shell entry points delegate reusable operations to `scripts/lib/*.sh`.

## Where to Add New Code

**New Core Feature:**
- Primary code: Add or extend a framework-independent singleton in `frontend/src/server/services/`.
- HTTP exposure: Add a thin handler under the matching path in `frontend/src/pages/api/`.
- SSR exposure: Import the service directly inside the relevant `getServerSideProps` in `frontend/src/pages/*.tsx`.
- Tests: Add focused tests beside the affected layer under `frontend/src/server/**/__tests__/` and route/component tests where behavior crosses a boundary.
- Config if needed: Extend `frontend/src/server/services/yamlService.ts`, `frontend/src/server/config/index.ts`, shared types, and `config.yaml.example` consistently.

**New Dashboard Page or Component:**
- Page definition: `frontend/src/pages/{route}.tsx`.
- Feature component: `frontend/src/components/{FeatureName}.tsx` or the relevant domain directory such as `frontend/src/components/cluster/`.
- Reusable presentation: `frontend/src/components/shared/`.
- Base control: `frontend/src/components/ui/`, following the existing primitive style.
- Browser integration: `frontend/src/lib/`; shared browser state: `frontend/src/context/`.
- Styles: Reuse/add design variables in `frontend/src/styles/globals.css`; do not introduce hard-coded palette colors in components.

**New API Route:**
- Definition: Add the URL-shaped file under `frontend/src/pages/api/`.
- Handler logic: Delegate to `frontend/src/server/services/`; keep request parsing, auth, and response mapping in the route.
- Types/validation: `frontend/src/server/types/index.ts` or a focused service module.
- Tests: `frontend/src/server/__tests__/api/` or a colocated API test directory matching existing coverage.

**New Kernel Integration:**
- Adapter: `frontend/src/server/services/adapters/{kernelName}Adapter.ts` implementing `KernelAdapter`.
- Types/registry: `frontend/src/server/types/index.ts` and the adapter selection in `frontend/src/server/services/nodeManager.ts`.
- Local process integration: A focused service under `frontend/src/server/services/` if binary lifecycle/conversion is required.
- Remote support: Extend `agent/src/handlers/` and Agent config contracts when child nodes must expose it.
- Tests: `frontend/src/server/services/adapters/__tests__/` plus relevant NodeManager/Agent tests.

**New CLI/Deployment Capability:**
- User-facing dispatch: `scripts/manage.sh` or a dedicated script under `scripts/`.
- Reusable shell implementation: the matching module in `scripts/lib/` (`install.sh`, `service.sh`, `build.sh`, `config.sh`, or `system.sh`).
- Service template: `config/` when systemd/nginx integration changes.
- Backend command helper: `frontend/src/server/cli/` only when a TypeScript service needs to generate or reason about commands.
- Tests: Add shell/E2E coverage under `scripts/` and unit tests under `frontend/src/server/cli/__tests__/` as appropriate.

**New Agent Endpoint:**
- Route dispatch: `agent/src/server.ts`.
- Handler: `agent/src/handlers/{capability}.ts` with HMAC enforcement where applicable.
- Configuration/types: `agent/src/config.ts` and `agent/agent.yaml.example`.
- Tests: `agent/src/__tests__/handlers.test.ts` or a focused new `*.test.ts` file.

**Utilities:**
- Browser-only helpers: `frontend/src/lib/`.
- Server-only helpers: `frontend/src/server/utils/`.
- Domain behavior: Prefer the owning service in `frontend/src/server/services/` over a generic utility.
- Shared domain type definitions: `frontend/src/server/types/index.ts`.

## Special Directories

**`frontend/.next/`:**
- Purpose: Next development/build output, including `standalone/` production artifacts.
- Source: Generated by `next build`.
- Committed: No; ignored build output.
- Packaging rule: Copy `.next/static` and `public` alongside standalone output through `scripts/prepare-standalone.sh`/deployment tooling.

**`node_modules/` and `frontend/node_modules/`:**
- Purpose: Bun workspace dependency installation.
- Source: Generated by `bun install` from root/frontend manifests and lockfile.
- Committed: No.

**`agent/miobridge-agent`:**
- Purpose: Native-like standalone Bun executable uploaded to child Linux nodes.
- Source: Generated from `agent/src/server.ts` by the build commands in `agent/package.json` or `scripts/build-agent.sh`.
- Committed: No build artifact.

**`~/.config/miobridge/`:**
- Purpose: Runtime config, binaries, generated data, logs, backups, state, and installed standalone distribution.
- Source: Created/managed by installation scripts and server services; it is outside the repository and independent of cwd.
- Committed: Not applicable.

**`.planning/codebase/`:**
- Purpose: GSD-generated current-state maps consumed by future planning/execution workflows.
- Source: Generated by `$gsd-map-codebase` mapper agents.
- Committed: Yes when the map workflow's documentation commit step is enabled.

**`.Codex/memory/`:**
- Purpose: Preserve concise topic-specific lessons and architecture/deployment/config conventions.
- Source: Maintained only for change categories listed in `AGENTS.md`.
- Committed: Yes.

**`.vercel/`:**
- Purpose: Local Vercel project-link metadata.
- Source: Generated by Vercel CLI.
- Committed: No; local integration state.

---

*Structure analysis: 2026-07-11*
*Update when directory structure changes*
