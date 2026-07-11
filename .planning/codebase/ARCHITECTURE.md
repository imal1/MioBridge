# Architecture

**Analysis Date:** 2026-07-11

## Pattern Overview

**Overall:** Layered Next.js full-stack monolith with a separately compiled remote-node agent and shell-based deployment tooling

**Key Characteristics:**
- The active application is one Next.js Pages Router service under `frontend/`; UI pages, SSR, API routes, startup jobs, and backend services ship together as a standalone Node deployment.
- Framework-independent domain logic lives in `frontend/src/server/**`; thin routes under `frontend/src/pages/api/**` and SSR loaders call singleton services directly.
- Runtime state is file-backed under `~/.config/miobridge` by default, with an optional Redis REST backend for multi-instance/Vercel state.
- Remote child nodes run the small HTTP Agent from `agent/src/server.ts`; the main node coordinates them over public HMAC-authenticated HTTP and uses SSH for deployment and diagnosis.
- External proxy kernels and conversion tools are subprocess dependencies rather than embedded libraries: `mihomo`, `yq`, and optionally `sing-box`.

## Layers

**Presentation Layer:**
- Purpose: Render the dashboard, cluster management, configuration, logs, subscription, and deployment workflows.
- Contains: Pages Router pages, shared layouts, domain components, UI primitives, browser-side API clients, and React contexts.
- Location: `frontend/src/pages/*.tsx`, `frontend/src/components/**`, `frontend/src/context/**`, `frontend/src/lib/**`.
- Depends on: Next.js/React, shared server types, browser API routes, and initial SSR props.
- Used by: Browser users of the dashboard.

**HTTP and SSR Boundary:**
- Purpose: Translate HTTP requests into service calls and serialize service results into page props, JSON, SSE, or files.
- Contains: `getServerSideProps` loaders, Next API route handlers, method/input checks, HMAC checks, response status mapping, and compatibility file routes.
- Location: `frontend/src/pages/**`, especially `frontend/src/pages/api/**`.
- Depends on: Services in `frontend/src/server/services/**`, middleware in `frontend/src/server/middleware/**`, and types in `frontend/src/server/types/index.ts`.
- Used by: Browser clients, subscription consumers, remote management callers, and Next.js SSR.
- Rule: Keep handlers thin. SSR loaders call services directly in-process, as in `frontend/src/pages/index.tsx`; do not self-call the app's HTTP API.

**Application Service Layer:**
- Purpose: Implement subscription conversion, cluster orchestration, deployment, kernel integration, configuration, and status collection independently of Next.js request objects.
- Contains: Singleton services such as `MioBridgeService`, `NodeManager`, `DeployManager`, `MihomoService`, `SingBoxService`, `YamlService`, and `UpdateChecker`.
- Location: `frontend/src/server/services/**`.
- Depends on: Runtime paths/configuration, persistence abstractions, filesystem/process/network adapters, and shared domain types.
- Used by: API routes, SSR loaders, and Node startup instrumentation.
- Rule: Add core behavior here through `XxxService.getInstance()` and expose it through a thin route or command adapter.

**Kernel Adapter and Process Layer:**
- Purpose: Normalize supported proxy kernels and execute external conversion/runtime binaries.
- Contains: `KernelAdapter` implementations for sing-box, Xray, and V2Ray; process invocation and binary discovery in kernel-specific services.
- Location: `frontend/src/server/services/adapters/**`, `frontend/src/server/services/mihomoService.ts`, `frontend/src/server/services/singBoxService.ts`, and `frontend/src/server/cli/deploy-commands.ts`.
- Depends on: Node filesystem and child-process APIs plus installed binaries.
- Used by: `NodeManager`, `MioBridgeService`, and `DeployManager`.

**Persistence and Runtime Configuration Layer:**
- Purpose: Resolve cwd-independent paths, parse YAML configuration, store node/deployment state, and protect read-modify-write operations.
- Contains: `getMioBridgeBaseDir`, `YamlService`, the `StateStore` interface, file and Redis REST implementations, deployment progress storage, and config projections.
- Location: `frontend/src/server/runtimePaths.ts`, `frontend/src/server/config/index.ts`, `frontend/src/server/services/yamlService.ts`, `frontend/src/server/services/stateStore.ts`, and `frontend/src/server/services/deployProgressStore.ts`.
- Depends on: `~/.config/miobridge`, `/tmp/miobridge` on Vercel, YAML parsing, filesystem APIs, or Redis REST environment configuration.
- Used by: All server services and startup initialization.

**Remote Agent Layer:**
- Purpose: Expose a minimal child-node control plane for status, updates, source URLs, logs, and health.
- Contains: A Bun-compiled HTTP server, YAML config loader, HMAC verification, and endpoint handlers.
- Location: `agent/src/server.ts`, `agent/src/config.ts`, `agent/src/hmac.ts`, and `agent/src/handlers/**`.
- Depends on: Bun/Node-compatible standard APIs, child-node kernel files/processes, and `~/.config/miobridge-agent/agent.yaml`.
- Used by: Main-node `NodeManager` HTTP checks and remote deployment workflows.

**Installation and Operations Layer:**
- Purpose: Detect Linux/architecture, install dependencies and binaries, build/copy standalone output, configure systemd, deploy releases, and manage service lifecycle.
- Contains: Shell entry points and focused libraries for build, configuration, install, service, and system operations.
- Location: `scripts/manage.sh`, `scripts/install.sh`, `scripts/server-deploy.sh`, `scripts/prepare-standalone.sh`, and `scripts/lib/**`; root `manage.sh` is a compatibility wrapper.
- Depends on: Linux utilities, Bun/Node, systemd, repository/build artifacts, and external release downloads.
- Used by: Operators and CI/CD.

## Data Flow

**Dashboard SSR and Browser Interaction:**

1. Next.js routes a browser request to a page such as `frontend/src/pages/index.tsx` or `frontend/src/pages/nodes.tsx`.
2. `getServerSideProps` dynamically imports server-only services and calls singleton methods directly.
3. `NodeManager` and `MioBridgeService` read runtime state, inspect generated files, and query local or remote kernels/agents.
4. Serialized results become initial React props; client components then use `frontend/src/lib/api.ts` for mutations and refreshes.
5. A thin handler in `frontend/src/pages/api/**` validates the request and delegates to the corresponding service.
6. The handler returns a typed JSON envelope, SSE stream, progress record, log payload, or generated subscription file.

**Subscription Generation:**

1. A manual `/api/update` request or the cron job in `frontend/src/instrumentation-node.ts` calls `MioBridgeService.updateSubscription()`.
2. `SingBoxService` collects local source URLs while `NodeManager.collectRemoteNodeSources()` requests sources from child Agents.
3. `MioBridgeService` extracts supported proxy protocols and `frontend/src/server/services/proxySources.ts` deduplicates and prepares conversion input.
4. Raw URLs and Base64 subscription output are written beneath the configured data directory.
5. `MihomoService` invokes `mihomo` to create `clash.yaml`; the previous/current subscription is copied into the backup directory.
6. `/api/file/[name]` serves the artifacts, with public compatibility rewrites defined in `frontend/next.config.js` for `/raw.txt`, `/subscription.txt`, and `/clash.yaml`.

**Remote Node Management:**

1. A cluster API route loads a node definition from `NodeManager`, whose durable representation is `nodes.yaml` through `StateStore`.
2. Normal status, URL, update, and log requests are sent to `http://<host>:<agentPort>` and signed with the shared HMAC secret.
3. `agent/src/server.ts` dispatches the request to a handler in `agent/src/handlers/**`, which validates HMAC and inspects or controls local kernels.
4. The Agent returns JSON/source text; `NodeManager` normalizes it into cluster status or subscription sources.
5. SSH operations are reserved for `DeployManager` installation, kernel detection, Agent upload/control, and diagnosis; progress is published through `deployProgressStore` and cluster progress routes.

**Service Startup:**

1. Node starts the Next standalone entry `frontend/.next/standalone/frontend/server.js` in development artifacts or `~/.config/miobridge/dist/frontend/server.js` after installation.
2. Next calls `frontend/src/instrumentation.ts`, which imports `frontend/src/instrumentation-node.ts` only when `NEXT_RUNTIME === 'nodejs'`.
3. Startup ensures runtime directories, checks optional binaries, loads/watches nodes, and registers the subscription cron schedule.
4. API routes and SSR pages then share the process-level service and state-store singletons.

**State Management:**
- Primary self-hosted state is YAML/files under `~/.config/miobridge`, resolved by `frontend/src/server/runtimePaths.ts` and independent of cwd.
- `frontend/src/server/services/stateStore.ts` defaults to mode-`0600` file storage with keyed in-process locks.
- When Redis REST credentials are configured, the same abstraction stores shared state with namespaced keys and distributed locks.
- Service classes use process singletons; selected hot-reload-sensitive stores use `globalThis` so Next development reloads retain state.
- Browser state is limited to React contexts/hooks such as `frontend/src/context/AppContext.tsx` and `frontend/src/lib/useClusterSSE.ts`; server state remains authoritative.

## Key Abstractions

**Singleton Domain Service:**
- Purpose: Centralize one domain's business rules without coupling them to Next.js.
- Examples: `frontend/src/server/services/mioBridgeService.ts`, `frontend/src/server/services/nodeManager.ts`, `frontend/src/server/services/deployManager.ts`.
- Pattern: Lazy static `getInstance()`; constructors may accept narrow overrides where tests need dependency substitution.

**StateStore:**
- Purpose: Present one asynchronous key/value and locking API over self-hosted files or serverless Redis.
- Examples: `FileStateStore` and `RedisStateStore` in `frontend/src/server/services/stateStore.ts`.
- Pattern: Strategy selected once from runtime environment, exposed through `getStateStore()`.

**KernelAdapter:**
- Purpose: Hide kernel-specific config discovery and proxy URL extraction behind a common contract.
- Examples: `frontend/src/server/services/adapters/singBoxAdapter.ts`, `xrayAdapter.ts`, and `v2rayAdapter.ts`.
- Pattern: Interface plus concrete adapters selected by kernel type.

**Next API Adapter:**
- Purpose: Map HTTP semantics to framework-independent service calls.
- Examples: `frontend/src/pages/api/update.ts`, `frontend/src/pages/api/cluster/status.ts`, and `frontend/src/pages/api/cluster/kernel/detect.ts`.
- Pattern: One default handler per filesystem route, with boundary validation, logging, and response mapping.

**Remote Agent Handler:**
- Purpose: Implement one authenticated child-node capability without a web framework.
- Examples: `agent/src/handlers/status.ts`, `agent/src/handlers/urls.ts`, and `agent/src/handlers/update.ts`.
- Pattern: Manual HTTP router delegates to functions that return Web `Response` objects.

## Entry Points

**Next.js Application:**
- Location: `frontend/src/pages/_app.tsx` and filesystem routes in `frontend/src/pages/**`.
- Triggers: `next dev`, Vercel's Next builder, or the standalone Node server.
- Responsibilities: Compose global providers/layout, route UI and API traffic, and invoke SSR loaders.

**Node Startup Instrumentation:**
- Location: `frontend/src/instrumentation.ts` and `frontend/src/instrumentation-node.ts`.
- Triggers: Next server initialization.
- Responsibilities: Guard Node-only imports, initialize directories/services, load cluster state, and schedule updates.

**Remote Agent Executable:**
- Location: `agent/src/server.ts`.
- Triggers: Compiled `miobridge-agent` process on a child Linux node.
- Responsibilities: Load Agent YAML, listen on the configured public port, route authenticated control requests, and handle shutdown signals.

**Management Scripts:**
- Location: `scripts/manage.sh`, `scripts/install.sh`, `scripts/server-deploy.sh`; compatibility entry at `manage.sh`.
- Triggers: Operator or CI shell invocation.
- Responsibilities: Install dependencies, build/copy artifacts, configure systemd, deploy releases, and start/stop/check services.

## Error Handling

**Strategy:** Services throw descriptive `Error` objects; HTTP/SSR/process entry boundaries catch them, log context, and convert them to stable responses or exit status.

**Patterns:**
- API routes use `try/catch`, `logger.error`, appropriate HTTP status codes, and `ApiResponse` payloads from `frontend/src/server/types/index.ts`.
- SSR loaders return nullable initial data plus a user-facing error string rather than failing the entire render.
- Optional startup checks in `frontend/src/instrumentation-node.ts` warn and continue so unavailable kernels do not prevent the dashboard from starting.
- `MioBridgeService.updateSubscription()` preserves useful partial results: raw subscriptions can succeed while Clash conversion records warnings/errors.
- Agent routing catches handler failures centrally in `agent/src/server.ts`; top-level initialization failure exits nonzero.
- Shell tooling enables fail-fast behavior and uses explicit status helpers from `scripts/lib/core.sh`.

## Cross-Cutting Concerns

**Logging:**
- Use the shared Winston logger at `frontend/src/server/utils/logger.ts` for server code; operational shell scripts use structured status functions from `scripts/lib/core.sh`.
- The Agent currently logs directly to stdout/stderr in `agent/src/server.ts`, suitable for systemd capture.

**Validation:**
- Validate HTTP methods and request fields at `frontend/src/pages/api/**` boundaries.
- Central domain validation and types live in `frontend/src/server/types/index.ts`; YAML structure is parsed/validated by `YamlService` and Agent config loading.
- `StateStore` rejects traversal outside its base directory; SSH credentials and uploaded private keys are validated in `frontend/src/server/services/sshCredential.ts`.

**Authentication:**
- Main/child HTTP uses HMAC verification in `frontend/src/server/middleware/hmac.ts` and `agent/src/hmac.ts` when a node secret is configured.
- SSH deployment supports password or uploaded private-key authentication and records/verifies host keys in `DeployManager`.

**Runtime Isolation:**
- Keep Node-only imports in `frontend/src/server/**`, `frontend/src/pages/api/**`, or `frontend/src/instrumentation-node.ts`.
- Preserve the runtime guard in `frontend/src/instrumentation.ts` so Edge compilation never statically resolves filesystem, subprocess, SSH, or logging modules.

---

*Architecture analysis: 2026-07-11*
*Update when major patterns change*
