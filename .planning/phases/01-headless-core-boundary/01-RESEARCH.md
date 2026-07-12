# Phase 1: Headless Core Boundary - Research

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Core Package Boundary
- **D-01:** The backend core no longer belongs under `frontend/src/server/**`; its canonical home is the independent workspace package `packages/core/`.
- **D-02:** `packages/core/` owns configuration, conversion, generation of `raw.txt`, `subscription.txt`, and `clash.yaml`, main-node aggregation, and the HMAC Agent client.
- **D-03:** SSH deployment, remote installation, systemd control, and Dashboard lifecycle management remain outside `packages/core/` and outside this phase.

### Public Consumer Contract
- **D-04:** The primary public entry point is a `MioBridgeCore` facade, supplemented only by a small set of focused subservices where consumers need narrower access.
- **D-05:** CLI, API routes, and SSR loaders must consume the same core services; business logic must not be copied into adapters.

### Migration Strategy
- **D-06:** Phase 1 switches existing API and SSR consumers to `packages/core/` in the same phase.
- **D-07:** Existing `frontend/src/server/**` import paths may temporarily re-export the new core symbols and must be marked deprecated to reduce migration risk; duplicate implementations must not remain active.
- **D-08:** The temporary compatibility layer is a migration bridge, not the canonical architecture. New code imports from `packages/core/`.

### the agent's Discretion
- Choose the internal subservice decomposition beneath `MioBridgeCore`, provided the locked capability boundary and single-source-of-truth rule are preserved.
- Choose the exact deprecated re-export annotations and equivalence-test organization.
- Choose whether purely frontend-specific logging or HTTP response helpers remain in `frontend`, provided they do not carry core business behavior.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

**Researched:** 2026-07-12
**Domain:** TypeScript/Bun workspace extraction, Node runtime application services, compatibility-preserving migration
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORE-01 | Core configuration, conversion, artifact generation, and status behavior is callable without starting Next.js. | Defines a Next-free package dependency boundary, direct package test harness, runtime-path contract, and conversion fixtures. |
| CORE-02 | CLI and Dashboard/API adapters share the same framework-independent application services rather than duplicating business logic. | Defines `MioBridgeCore` as composition root, focused public exports, frontend cutover sequence, and deprecated forwarding modules. |
| CORE-03 | Runtime configuration, data, logs, backups, dist assets, and managed binaries consistently resolve beneath `~/.config/miobridge` independent of cwd, while `MIOBRIDGE_CONFIG_DIR` supports isolated tests. | Inventories every runtime path and cwd-dependent lookup, then prescribes a single injected `RuntimePaths` policy and path-contract tests. |
</phase_requirements>

## Summary

Phase 1 should be planned as a dependency-direction refactor, not a bulk directory move. The current core is mostly framework-independent, but its modules form several cycles and hidden initialization dependencies: `MioBridgeService` dynamically imports `NodeManager`; `NodeManager` owns both core Agent communication and out-of-scope SSH/deployment state; configuration loads `YamlService` eagerly; and the logger lazily requires configuration to survive a logger/config cycle. `[VERIFIED: frontend/src/server/services, config, and utils imports]` Moving these files unchanged would produce a package that is physically separate but still tightly coupled and initialization-order-sensitive.

The recommended boundary is a Node-only workspace package named `@miobridge/core`, with `MioBridgeCore` as an explicit composition root. Split the current `NodeManager` into a core node registry/aggregation service plus an Agent HTTP client, and keep deploy delegation, SSH credentials, deployment progress, and deployment commands in frontend until their later phase. `[VERIFIED: 01-CONTEXT.md D-02/D-03 and NodeManager method inventory]` Configuration, runtime paths, state storage, source normalization, sing-box discovery, mihomo conversion, artifact generation, status, domain types, and protocol validation move to core. Next request/response helpers, Next HMAC middleware, frontend logging presentation, SSH deployment, and systemd/dashboard lifecycle remain adapters outside core. `[VERIFIED: codebase import graph]`

Do the migration behind equivalence tests before switching consumers. Preserve exact raw/Base64/Clash behavior, partial-success semantics, main/child ownership, HMAC request wire format, and runtime path precedence unless a separate requirement explicitly changes them. `[VERIFIED: MioBridgeService, NodeManager, memory/bug-fixes.md]` The only intentional behavioral correction required by CORE-03 is eliminating cwd as an authoritative runtime lookup: repository `bin/` may remain a development fallback, but managed/runtime locations must derive from the resolved base directory and explicit package/application roots. `[VERIFIED: runtimePaths.ts, mihomoService.ts, REQUIREMENTS.md CORE-03]`

**Primary recommendation:** Establish the package and test seam first, extract dependency-free primitives bottom-up, split mixed responsibilities, switch frontend consumers, then leave deprecated forwarding modules containing no implementation.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Runtime path and config resolution | Core application package | File/Redis storage adapter | Both CLI and Dashboard need one cwd-independent policy. `[VERIFIED: CORE-03]` |
| Source collection and normalization | Core application package | Kernel and Agent adapters | Orchestration is product behavior; OS/process/HTTP details are ports. `[VERIFIED: MioBridgeService.updateSubscription]` |
| Artifact generation/status | Core application package | Filesystem and mihomo process adapters | The three compatibility artifacts are core outputs independent of HTTP. `[VERIFIED: CORE-01 and MioBridgeService]` |
| Child Agent HMAC communication | Core application package | Remote Agent runtime | The main-side client belongs in core; the child executable remains separate. `[VERIFIED: D-02 and AGENTS.md]` |
| API serialization and HTTP auth middleware | Next.js boundary | Core facade | Request types/status codes are framework-specific and must not enter core. `[VERIFIED: pages/api and middleware/hmac.ts]` |
| SSR data loading | Next.js boundary | Core facade | SSR directly calls core in-process and remains a consumer. `[VERIFIED: AGENTS.md]` |
| SSH deployment, credentials, systemd | Frontend operations adapter for now | Later CLI package | Explicitly excluded from core and Phase 1. `[VERIFIED: D-03]` |
| Child Agent server/kernel inspection | Agent executable | Core Agent client contract | The Agent remains an independently compiled runtime. `[VERIFIED: agent/src and D-02]` |

## Project Constraints (from AGENTS.md)

- The active Dashboard remains a Next.js Pages Router full-stack app with Node runtime, SSR, and standalone output; do not add Express. `[VERIFIED: AGENTS.md]`
- D-01 supersedes only the old location rule: framework-independent backend business logic now belongs in `packages/core/`; keep `XxxService.getInstance()` compatibility where useful and routes thin. `[VERIFIED: CONTEXT canonical_refs]`
- SSR pages call services directly in `getServerSideProps`; they must not self-call HTTP. `[VERIFIED: AGENTS.md]`
- Node-only imports must not enter browser bundles; retain the guarded dynamic import from `instrumentation.ts` when `NEXT_RUNTIME === 'nodejs'`. `[VERIFIED: AGENTS.md]`
- Runtime state defaults below `~/.config/miobridge`; config is `config.yaml`; binary preference is managed base `bin/`, repository `bin/`, then PATH. `[VERIFIED: AGENTS.md]`
- Compatibility URLs remain Next rewrites to thin internal routes. `[VERIFIED: AGENTS.md and next.config.js]`
- Main node generates artifacts; child nodes expose Agent/kernel sources; routine checks use public HMAC HTTP while SSH is deployment/diagnosis only. `[VERIFIED: AGENTS.md]`
- Verification commands remain `bun run lint`, `bun run typecheck`, `bun run build`, relevant frontend Vitest tests, and Agent tests. Do not use root `npx tsc --noEmit`. `[VERIFIED: AGENTS.md]`
- Standalone builds must retain `.next/static`, `public`, and required traced runtime assets. `[VERIFIED: AGENTS.md and next.config.js]`
- Record the new durable architecture boundary briefly in `.Codex/memory/project-architecture.md`; update config/coding memory only if those conventions materially change. `[VERIFIED: AGENTS.md Memory section]`

## Existing Dependency Graph and Migration Seams

### High-risk cycles to break

1. `MioBridgeService -> dynamic NodeManager -> MioBridgeService`: subscription update gathers remote sources by dynamically importing the singleton, while `NodeManager` constructs with the MioBridge singleton for local update. `[VERIFIED: mioBridgeService.ts and nodeManager.ts]` Resolve by injecting `RemoteSourceCollector` into `MioBridgeCore` and letting the composition root connect services after construction.
2. `config -> YamlService -> logger -> require(config)`: eager config construction and module-load logger creation create a temporal initialization dependency already associated with a shipped TDZ regression. `[VERIFIED: config/index.ts, yamlService.ts, logger.ts, memory/bug-fixes.md]` Resolve with an injected lightweight `CoreLogger` interface and lazy/config-service accessors; core modules must not create directories merely by being imported.
3. `NodeManager` mixes node registry, Agent HTTP, artifact update orchestration, file watching, SSH credential persistence, and deployment callbacks. `[VERIFIED: NodeManager method inventory]` Extract `AgentClient`, `NodeRepository/NodeRegistry`, and `NodeAggregationService`; keep deploy callbacks and SSH mutations outside the core facade.
4. `version.ts` imports `frontend/package.json` by relative path. `[VERIFIED: frontend/src/server/version.ts]` Move version metadata behind constructor/build-time input or read core package metadata without reaching back into frontend.

### Recommended extraction order

1. Domain types and pure functions: kernel types/validators and `proxySources`.
2. Runtime path policy and logger interface.
3. State store interfaces/implementations and YAML/config service.
4. Kernel/process adapters (`SingBoxService`, `MihomoService`) with injected paths/logger.
5. Agent client, node repository, and aggregation service split from `NodeManager`.
6. Artifact/update/status service and `MioBridgeCore` composition root.
7. Core tests and package exports.
8. Frontend consumer cutover and deprecated re-export files.
9. Build/standalone tracing verification and removal of duplicate frontend implementations.

This bottom-up order ensures each moved layer depends only on already-extracted layers and Node standard APIs, never on frontend. `[VERIFIED: current import graph]`

## Standard Stack

### Core

| Library/runtime | Resolved version | Purpose | Why Standard Here |
|-----------------|------------------|---------|-------------------|
| TypeScript | lockfile/project resolved version | Strict public contracts and package compilation | Already used throughout the repository; no new language/toolchain is needed. `[VERIFIED: package manifests and lockfile]` |
| Bun workspaces | Bun 1.2.13 in research environment | Workspace linking, scripts, and fast Vitest-compatible execution | Root already declares Bun and workspaces; extend `workspaces` with `packages/*`. `[VERIFIED: package.json and environment probe]` |
| Vitest | 4.1.9 manifest range/resolution | Unit and integration equivalence tests | Existing frontend server test suite already uses Vitest and mocks Node/process boundaries. `[VERIFIED: frontend/package.json and vitest.config.ts]` |
| `yaml` | 2.8.0 manifest range/resolution | In-process YAML parsing/stringifying where already used | Existing conversion code relies on it; `yq` remains an external operational tool where required. `[VERIFIED: frontend/package.json and mihomoService.ts]` |
| `fs-extra` | 11.3.0 manifest range/resolution | Existing filesystem behavior during a low-risk extraction | Preserves existing service APIs and test behavior; reconsidering it is not required for this phase. `[VERIFIED: frontend/package.json and service imports]` |
| `axios` | 1.10.0 manifest range/resolution | Existing subscription fetch behavior in mihomo adapter | Retain during equivalence migration; Agent client already uses standard `fetch`. `[VERIFIED: frontend/package.json, mihomoService.ts, nodeManager.ts]` |
| `winston` | 3.17.0 manifest range/resolution | Default Node logging adapter | Keep behind a core logger interface so core tests and future CLI can inject alternatives. `[VERIFIED: frontend/package.json and logger.ts]` |

No new external package is required. Move only the dependencies actually imported by the extracted core into `packages/core/package.json`; do not inherit the root's stale Express/CORS/Helmet dependencies. `[VERIFIED: package.json and codebase CONCERNS.md]`

### Package shape

Use a private workspace package initially, with an explicit `exports` map and no frontend path aliases inside it. A suitable shape is:

```text
packages/core/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                  # public exports only
│   ├── mioBridgeCore.ts          # composition root/facade
│   ├── config/                   # config service and validation
│   ├── runtime/                  # RuntimePaths, logger/clock/process ports
│   ├── artifacts/                # source normalization and generation
│   ├── kernels/                  # mihomo/sing-box adapters
│   ├── nodes/                    # AgentClient, repository, aggregation
│   ├── state/                    # StateStore adapters
│   └── types/                    # domain-only types
└── test/                         # fixtures/equivalence tests
```

Prefer package source exports for this monorepo phase if Next/Bun consume TypeScript directly, or emit `dist/` if the package is independently typechecked/built; whichever route is chosen, add an explicit core `typecheck` and `test` script. `[VERIFIED: current Next moduleResolution=bundler and Bun workspace setup]` The planner must verify `next build` accepts the workspace source; if it does not, add `transpilePackages: ['@miobridge/core']` to Next config rather than reaching into `packages/core/src` from frontend. `[ASSUMED: Next workspace transpilation may be required depending on exports/build choice]`

## Architecture Patterns

### System Architecture Diagram

```text
CLI (later) ───────────────┐
                          │
Next API / SSR ───────────┼──> MioBridgeCore facade
                          │        │
Instrumentation scheduler ┘        ├──> ConfigService + RuntimePaths
                                   ├──> ArtifactService
                                   │      ├──> Local source adapter
                                   │      └──> NodeAggregationService
                                   │              └──> AgentClient --HMAC HTTP--> child Agent
                                   ├──> MihomoProcessAdapter --> managed/repo/PATH binary
                                   └──> StateStore --> files under base dir or Redis REST

Next-only adapters: HTTP request/response, Next HMAC middleware, UI serialization
Outside Phase 1/core: SSH DeployManager, credentials, deploy progress, systemd, Dashboard lifecycle
```

### Pattern 1: Explicit composition root

`MioBridgeCore` should construct defaults once and accept overrides for tests and later CLI composition. Avoid hidden cross-singleton imports.

```typescript
export interface MioBridgeCoreOptions {
  paths?: RuntimePaths;
  logger?: CoreLogger;
  stateStore?: StateStore;
  agentTransport?: AgentTransport;
  clock?: Clock;
}

export class MioBridgeCore {
  static getInstance(options?: MioBridgeCoreOptions): MioBridgeCore;
  readonly artifacts: ArtifactService;
  readonly nodes: NodeAggregationService;
  readonly config: ConfigService;
}
```

The exact API is discretionary, but defaults must be created inside this package and tests must be able to override filesystem/network/process/time boundaries. `[VERIFIED: existing constructor overrides in MioBridgeService tests demonstrate this seam]`

### Pattern 2: Ports around side effects

Use small interfaces for logger, filesystem-sensitive path policy, process execution, HTTP transport, clock, and state store. Do not abstract pure string/array transformations. This makes equivalence tests deterministic without mocking import graphs. `[VERIFIED: current tests already inject partial services and mock external binaries/HTTP]`

### Pattern 3: Compatibility re-exports only

Old modules should contain documentation and exports, not subclasses or copied bodies:

```typescript
/** @deprecated Import from '@miobridge/core'. */
export { MioBridgeService } from '@miobridge/core';
```

If old class names must remain, export aliases from the core package. A repository check should ensure compatibility modules contain no business implementation. `[VERIFIED: D-07/D-08]`

### Pattern 4: Core versus operations split in NodeManager

Move these behaviors to core: node schema/serialization, state-backed registry, Agent URL construction, signed request creation, remote status/health/update/log/source calls, source validation/deduplication, and cluster aggregation. `[VERIFIED: D-02 and NodeManager methods]` Keep these outside core: SSH private-key validation/storage if used solely for deployment, deploy delegate registration/auto-deploy, deployment lifecycle state, kernel installation/detection via SSH, and systemd operations. `[VERIFIED: D-03]` A frontend `OperationsNodeService` may coordinate core registry records with `DeployManager` until the CLI phase.

### Anti-Patterns to Avoid

- **Mechanical move of `frontend/src/server`:** preserves cycles and brings SSH/Next concerns into core.
- **Core importing `@/server/*` or `next`:** reverses the intended dependency direction; add an automated grep/import-boundary test.
- **Two live implementations:** deprecated paths must re-export the canonical symbols.
- **Import-time filesystem/process behavior:** importing core must not create log directories, read cwd-specific files, or spawn binaries.
- **Broad public exports:** export the facade, required domain types, and narrow services; keep adapters/internal helpers package-private.
- **Changing HMAC protocol while moving it:** protocol redesign is not a requirement and risks Agent incompatibility.
- **Moving deploy types merely because UI imports them:** keep deployment-only types in an operations/shared adapter module outside core.

## Runtime Path Ownership

Create one `RuntimePaths` value derived from `MIOBRIDGE_CONFIG_DIR` or `~/.config/miobridge`. It should expose at least config, data/www, logs, backups, dist, and managed-bin locations. `[VERIFIED: CORE-03 and config conventions]` Resolve it per core instance or lazily rather than as a module constant so tests can set `MIOBRIDGE_CONFIG_DIR` before composition without module-cache resets. `[VERIFIED: current CONFIG_DIR module constant and env-reset tests show the risk]`

Binary discovery must be explicit and testable:

1. `MIOBRIDGE_MIHOMO_PATH` or configured executable/path.
2. `<baseDir>/bin/mihomo`.
3. an explicitly supplied repository/application bin root for development/standalone packaging.
4. `PATH`.

Do not use `process.cwd()` to infer production paths. Current `mihomoService.ts` tries several cwd-relative locations and `DeployManager` uses cwd for the Agent binary; the former must be corrected in core, while the latter remains outside this phase but should be recorded as later operations debt. `[VERIFIED: cwd grep]`

The current Vercel `/tmp/miobridge` fallback conflicts with the milestone's future synthetic read-only demo model but is not Phase 1's demo change. Preserve it only as a frontend-supplied runtime-path policy, not as an implicit core global rule; the default core policy should satisfy CORE-03. `[VERIFIED: runtimePaths.ts, PROJECT.md, Phase 5 scope]`

## Behavioral Equivalence Contract

Before moving implementations, capture fixtures/tests for:

- extraction of supported proxy schemes and exact-URL global deduplication;
- raw output ordering/content and Base64 encoding;
- Clash-only naming with region prefix and conflict suffix behavior;
- invalid Clash naming sources remaining in raw/Base64 while producing warnings;
- partial success when raw/subscription succeed but mihomo/Clash fails;
- no artifact replacement when all sources fail;
- backup naming/content after a successful subscription write;
- status fields, sizes, timestamps, node count, version metadata, and mihomo availability;
- main-node aggregation of local and remote kernel-tagged sources;
- offline fixed sing-box/Xray/V2Ray status shape;
- Agent request base URL/port, HMAC headers, payload format, timeouts, response validation, and error redaction;
- `MIOBRIDGE_CONFIG_DIR` isolation and cwd changes producing identical path/output behavior.

These are all shipped behaviors or bug-fix protections rather than new features. `[VERIFIED: service tests, memory/project-architecture.md, memory/bug-fixes.md]`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML syntax parser | line parser for general config | Existing `yaml`/`YamlService` path | YAML edge cases exceed the hand-written node subset. `[VERIFIED: existing dependency]` |
| Cryptographic comparison/HMAC | custom digest or string comparison | Node `crypto.createHmac` and `timingSafeEqual` | Preserve protocol/security primitives. `[VERIFIED: existing implementations]` |
| Base/runtime path scattered constants | per-service homedir/cwd joins | One `RuntimePaths` policy | CORE-03 needs one testable owner. |
| HTTP framework inside core | Express or Next handlers | transport interface plus standard `fetch`/existing Axios adapter | Core is an in-process library, not a server. `[VERIFIED: AGENTS.md]` |
| Conversion fallback | custom Clash parser/converter | Existing mihomo process integration | Project explicitly treats mihomo as required for Clash generation. `[VERIFIED: memory/bug-fixes.md]` |
| New dependency injection container | third-party DI framework | explicit constructors and `MioBridgeCore` composition | Current scope is small and existing tests already use constructor overrides. `[VERIFIED: MioBridgeService constructor]` |

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `config.yaml`, `nodes.yaml`, `www/raw.txt`, `www/subscription.txt`, `www/clash.yaml`, backups, logs, StateStore `ssh-keys/*`, deploy progress, and optional Redis keys under `miobridge:`. `[VERIFIED: runtime paths, state store, NodeManager]` | No format/key migration in Phase 1. Core must continue reading/writing the same locations and keys. Add compatibility fixtures against a pre-extraction temp base directory. SSH/deploy records stay owned by frontend operations adapters. |
| Live service config | Optional Upstash/Vercel KV REST endpoint/token selects Redis-backed StateStore; Vercel runtime behavior is env-driven. No additional UI-only external configuration was found in repository evidence. `[VERIFIED: stateStore.ts; no external provider inspection available]` | Preserve env names and Redis key namespace during extraction. Do not make an external-data migration. Phase 5 will replace Vercel operational behavior. |
| OS-registered state | Existing production may have a `miobridge` systemd service pointing at the Next standalone server and installed files under `<baseDir>/dist`; child hosts may have `miobridge-agent`. `[VERIFIED: AGENTS.md and scripts]` | No re-registration in Phase 1 because entrypoint/dashboard lifecycle is unchanged. Verify standalone server still starts after package extraction. Record that later CLI/dashboard phases own service migration. |
| Secrets/env vars | `MIOBRIDGE_CONFIG_DIR`, `MIOBRIDGE_MIHOMO_PATH`, Redis REST URL/token pairs, Vercel variables, node HMAC secrets in nodes state, and SSH credential references/private-key state. `[VERIFIED: env grep and config memory]` | Keep names and redaction behavior unchanged. Core owns node HMAC secret use and StateStore selection; SSH credentials remain outside core. No secret value migration. |
| Build artifacts / installed packages | Bun workspace links/lockfile, Next standalone traced files, `frontend/bin/mihomo` or repo/managed binary, `.next` artifacts, and installed `<baseDir>/dist/frontend/server.js`. `[VERIFIED: package manifests, next.config.js, AGENTS.md]` | Add `packages/core` to workspaces and standalone tracing; rebuild `.next`/standalone output. Do not manually edit installed artifacts. Validate clean install/build and runtime launch. |

After every source file is moved, the main residual state risk is an installed standalone build or systemd process still running the previous compiled frontend tree. Rebuilding/reinstalling is sufficient; there is no persistent schema rename in this phase. `[VERIFIED: no key/path rename is required]`

## Common Pitfalls

### Pitfall 1: Package boundary exists only on disk
**What goes wrong:** `packages/core` imports frontend aliases or compatibility shims, so CLI use still transitively requires Next.
**How to avoid:** Add a boundary test/grep that rejects `next`, React, `@/`, `frontend/`, deploy manager, and SSH imports from core; test importing and invoking core from repository root without starting Next.

### Pitfall 2: Logger/config initialization regression
**What goes wrong:** eager singletons recreate the Bun TDZ/cycle or import-time directory writes.
**How to avoid:** inject logger and resolve config lazily through the composition root; test clean dynamic imports under Bun and Node with a temp config directory. `[VERIFIED: shipped TDZ bug]`

### Pitfall 3: `NodeManager` extraction drags deployment into core
**What goes wrong:** SSH, private keys, auto-deploy callbacks, and deployment statuses become CLI-core dependencies.
**How to avoid:** split by responsibility before moving; frontend operations code composes deploy behavior around the core registry.

### Pitfall 4: Cwd-dependent binary discovery passes locally
**What goes wrong:** tests/build run from repo root, but installed CLI or standalone server runs elsewhere and cannot locate mihomo.
**How to avoid:** run path tests from multiple cwd values and with only `<MIOBRIDGE_CONFIG_DIR>/bin/mihomo` available.

### Pitfall 5: Workspace compiles but standalone omits package/assets
**What goes wrong:** Next dev resolves workspace source, while `.next/standalone` misses core files or external binary paths.
**How to avoid:** run the production build, inspect/copy standalone artifacts through the existing script, then start the built server and hit status/file routes.

### Pitfall 6: Type exports pull Node code into browser chunks
**What goes wrong:** frontend components import runtime values from the Node-only package, or TypeScript imports are not marked type-only.
**How to avoid:** use `import type`, keep browser-safe domain types free of Node imports, and inspect/build client bundles. Current UI imports numerous server types, so this cutover needs deliberate classification. `[VERIFIED: frontend import grep]`

### Pitfall 7: Migration accidentally fixes or redesigns HMAC
**What goes wrong:** main and child signatures diverge, or a security redesign expands scope and breaks deployed Agents.
**How to avoid:** freeze wire-format fixtures first and move client code unchanged behind `AgentClient`. Track known replay/identity weaknesses separately unless the implementation exposes an immediate regression.

### Pitfall 8: Tests move but root commands remain misleading
**What goes wrong:** `bun test` or root `test` still says tests are unconfigured, and CI never runs core tests.
**How to avoid:** add explicit `core:test`/`core:typecheck` scripts and route the root test command to core/frontend/agent as appropriate without using root `npx tsc --noEmit`. `[VERIFIED: root package.json]`

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.9 through existing Bun workspace dependencies `[VERIFIED: frontend/package.json]` |
| Config file | `frontend/vitest.config.ts`; core-specific config/script is a Wave 0 gap |
| Quick run command | `bun run --cwd packages/core test --run` (final script spelling to match package manifest) |
| Full suite command | `bun run lint && bun run typecheck && bun run --cwd packages/core test && bun run --cwd frontend test && (cd agent && bun test) && bun run build` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORE-01 | Import core without Next; config/update/status and artifacts work from temp runtime base | unit + integration | `bun run --cwd packages/core test --run test/headless-core.test.ts` | ❌ Wave 0 |
| CORE-01 | Existing conversion outputs and partial-failure results remain equivalent | fixture/contract | `bun run --cwd packages/core test --run test/artifact-equivalence.test.ts` | ❌ Wave 0; source tests exist in frontend |
| CORE-02 | Frontend API/SSR consumers use core and compatibility files only re-export | boundary + frontend integration | `bun run --cwd frontend test --run src/server/__tests__/core-boundary.test.ts` | ❌ Wave 0 |
| CORE-02 | Cluster/source behavior and Agent HMAC contract remain compatible | integration | `bun run --cwd packages/core test --run test/agent-client.test.ts test/node-aggregation.test.ts` | ❌ Wave 0; source NodeManager tests exist |
| CORE-03 | All runtime paths stay below resolved base and ignore cwd; override isolates state | unit | `bun run --cwd packages/core test --run test/runtime-paths.test.ts` | ❌ Wave 0; predecessor test exists |
| CORE-03 | Managed binary lookup works outside repository cwd | integration | `bun run --cwd packages/core test --run test/mihomo-adapter.test.ts` | ❌ Wave 0; predecessor test exists |

### Sampling Rate

- **Per task commit:** affected core test file plus `bun run --cwd packages/core typecheck`.
- **Per wave merge:** all core tests and affected frontend Vitest tests.
- **Phase gate:** root lint/typecheck, core/frontend/Agent suites, production standalone build, and a headless core smoke invocation from a non-repository cwd.

### Wave 0 Gaps

- [ ] `packages/core/package.json`, `tsconfig.json`, and Vitest config/script.
- [ ] `packages/core/test/fixtures/` containing representative local/remote sources, expected raw/Base64/Clash outputs, node YAML, Agent payloads, and partial-failure results captured before migration.
- [ ] `packages/core/test/runtime-paths.test.ts` including changed-cwd and env-isolation cases.
- [ ] `packages/core/test/headless-core.test.ts` proving no Next server/import is required.
- [ ] `frontend/src/server/__tests__/core-boundary.test.ts` preventing duplicate implementation and frontend imports from core.
- [ ] Root scripts that run core tests/typecheck without replacing the valid frontend-scoped typecheck gate.

## Security Domain

Security enforcement is enabled because no `.planning/config.json` disables it. `[VERIFIED: config file absent]`

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes, Agent-to-main contract | Preserve per-node shared-secret HMAC behavior and exact compatibility tests; do not broaden management authentication in this phase. |
| V3 Session Management | no | Core has no browser/user session responsibility. |
| V4 Access Control | limited | Node registry selects each node's secret and enabled state; HTTP management authorization remains Next/later scope. |
| V5 Input Validation | yes | Preserve kernel config validators, remote response shape validation, path containment, YAML/config validation, and allowed artifact names. |
| V6 Cryptography | yes | Node `crypto` HMAC-SHA256 and timing-safe comparison; never custom crypto. |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| State key path traversal | Tampering | Resolve against normalized base directory and reject paths outside it; retain trailing-separator regression test. `[VERIFIED: stateStore fix]` |
| HMAC secret/header leakage | Information disclosure | Never log secrets/signatures/full proxy URLs; preserve redaction and error normalization. `[VERIFIED: bug-fixes.md]` |
| HMAC replay/identity weakness | Spoofing | Preserve compatibility in Phase 1, document existing timestamp/replay weaknesses, and avoid worsening them; protocol changes require synchronized Agent work and dedicated requirements. `[VERIFIED: codebase CONCERNS.md]` |
| Untrusted remote Agent JSON | Tampering | Validate kernel types, URL shapes, node identity consistency, response size/timeouts before aggregation. `[VERIFIED: NodeManager validation methods]` |
| Process argument/path injection | Elevation/Tampering | Keep binary path resolution explicit, avoid shell interpolation, validate executable availability, and isolate temp dirs. `[VERIFIED: current process integration concerns]` |
| Secret persistence crossing package boundary | Information disclosure | Keep SSH credentials outside core; core may use node HMAC secrets but public result types and logs must omit them. `[VERIFIED: D-03 and NodeManager]` |

The phase should not claim to solve known management authentication, CSRF, Redis lock, or HMAC protocol-design weaknesses; it must preserve current security behavior and make the new boundary no worse. `[VERIFIED: PROJECT deferred AUTH-01 and codebase CONCERNS.md]`

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Bun | workspace/test execution | ✓ | 1.2.13 | Node can run built Dashboard, but Bun remains project package manager |
| Node.js | Next production/build tooling | ✓ | 22.17.0 | — |
| mihomo | real Clash conversion | ✗ in PATH during research | — | Use existing fixture/fake-binary tests; production smoke requires managed/repo binary |
| yq | operational YAML tooling | ✗ in PATH during research | — | Core parsing tests use existing in-process YAML; installer work is Phase 2 |
| sing-box | local source discovery | ✗ in PATH during research | — | Mock/fixture adapter; local source absence is existing partial behavior |

**Missing dependencies with no fallback:** none for planning or unit/equivalence implementation; a true live conversion smoke needs a verified mihomo binary.

**Missing dependencies with fallback:** mihomo, yq, and sing-box can be covered with existing fake-binary/fixture techniques during Phase 1. Their guided installation belongs to Phase 2.

## Package Legitimacy Audit

No new external package is recommended, so the package-legitimacy gate is not triggered. Existing packages should be moved/redeclared only when current extracted source imports them. `[VERIFIED: package manifests and extraction scope]`

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Next may require `transpilePackages` when consuming workspace TypeScript source, depending on the chosen exports/build strategy. | Standard Stack / Package shape | A clean Next build will reveal this; planner should make it an explicit verification rather than assuming. |

## Open Questions

1. **Source exports versus built `dist` for `@miobridge/core`**
   - What we know: Bun workspaces and Next bundler resolution are present; the future CLI needs a stable package boundary. `[VERIFIED: manifests]`
   - What's unclear: whether the project prefers checked-in/produced package JS before Phase 3 or direct TypeScript workspace consumption.
   - Recommendation: begin with private workspace source plus independent `typecheck`; require clean Next standalone build. Add `dist` only if packaging/runtime evidence requires it.

2. **Frontend logger ownership**
   - What we know: current Winston logger has config and filesystem side effects and participates in a cycle. `[VERIFIED: logger.ts]`
   - What's unclear: whether all Node consumers should share Winston formatting immediately.
   - Recommendation: define `CoreLogger`; ship a default core Node logger only if headless behavior requires file logs, while frontend-specific presentation stays in frontend.

3. **Redis store in the durable core versus demo-only future**
   - What we know: current operational behavior supports Redis REST, while Phase 5 will make Vercel demo synthetic/read-only. `[VERIFIED: stateStore.ts and roadmap]`
   - Recommendation: retain Redis adapter for behavioral compatibility but construct it only from explicit environment/options; do not let Vercel-specific policy dominate core defaults.

## Sources and Provenance

### Primary (HIGH confidence)

- `.planning/phases/01-headless-core-boundary/01-CONTEXT.md` — locked scope and migration decisions.
- `.planning/REQUIREMENTS.md`, `.planning/PROJECT.md`, `.planning/STATE.md`, `.planning/ROADMAP.md` — requirement and milestone boundaries.
- `AGENTS.md` — repository architecture, commands, deployment, and memory rules.
- `frontend/src/server/services/{mioBridgeService,nodeManager,mihomoService,stateStore,yamlService,singBoxService,proxySources}.ts` — current implementation and dependency seams.
- `frontend/src/server/{runtimePaths.ts,config/index.ts,utils/logger.ts,types/index.ts,version.ts}` — initialization, paths, shared types, and cycles.
- `frontend/src/pages/**`, `frontend/src/instrumentation-node.ts`, `frontend/next.config.js` — consumer/import and standalone packaging evidence.
- `frontend/src/server/**/__tests__`, `frontend/vitest.config.ts` — existing validation patterns and gaps.
- `agent/src/hmac.ts`, `agent/src/server.ts`, `agent/src/handlers/**` — child protocol boundary.
- `.Codex/memory/{project-architecture,config-patterns,bug-fixes,coding-conventions}.md` and `.claude/roadmap/README.md` — shipped behavior and regression constraints.
- `.planning/codebase/{ARCHITECTURE,STACK,CONCERNS}.md` — mapped architecture and known risk inventory.
- `package.json`, `frontend/package.json`, `frontend/tsconfig.json`, Bun lockfile — workspace/toolchain evidence.

External research providers were disabled by the init context and no new package/API was needed; codebase evidence is therefore the authoritative source for this migration. No external source content was copied into this artifact.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — existing manifests, lockfile, environment probes, and source imports determine the required stack.
- Architecture: HIGH — derived from complete local import/method/runtime-path inspection and locked decisions.
- Pitfalls: HIGH — most correspond to existing cycles, known bugs, or observable packaging/test gaps.
- Next workspace transpilation detail: LOW — explicitly logged as A1 and gated by build verification.

**Research date:** 2026-07-12
**Valid until:** 2026-08-11; architecture evidence remains valid until relevant source changes.
