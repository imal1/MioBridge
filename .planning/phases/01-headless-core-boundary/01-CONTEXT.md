# Phase 1: Headless Core Boundary - Context

**Gathered:** 2026-07-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Create a framework-independent `packages/core/` workspace package that owns configuration, subscription conversion, compatibility artifact generation, node aggregation, and HMAC Agent communication. Switch the existing Next.js API and SSR consumers to this shared core without adding the Linux installer, the complete CLI command surface, SSH deployment, systemd management, or Dashboard lifecycle behavior assigned to later phases.

</domain>

<decisions>
## Implementation Decisions

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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Scope and Requirements
- `.planning/PROJECT.md` — CLI-first product direction, runtime constraints, and superseded deployment assumptions.
- `.planning/REQUIREMENTS.md` — Phase 1 requirements `CORE-01`, `CORE-02`, and `CORE-03`.
- `.planning/ROADMAP.md` — fixed Phase 1 boundary and observable success criteria.
- `AGENTS.md` — repository architecture rules and active verification commands; its former `frontend/src/server/**` core-location rule is superseded for Phase 1 by D-01 above.

### Shipped Architecture and Runtime Conventions
- `.Codex/memory/project-architecture.md` — main/child node ownership, HMAC Agent checks, compatibility URLs, and service boundaries that extraction must preserve.
- `.Codex/memory/config-patterns.md` — config path resolution, `MIOBRIDGE_CONFIG_DIR`, validation, backup, and atomic persistence conventions.
- `.Codex/memory/bug-fixes.md` — shipped fixes and fragile behavior that must not regress during extraction.
- `.Codex/memory/coding-conventions.md` — repository TypeScript and service conventions.
- `.claude/roadmap/README.md` — distributed-node baseline and compatibility behavior.

### Codebase Evidence
- `.planning/codebase/ARCHITECTURE.md` — current Next.js adapter/service layering, request flows, singleton services, and Node-runtime constraints.
- `.planning/codebase/STACK.md` — workspace, runtime, dependency, binary, and test-tool constraints.
- `.planning/codebase/CONCERNS.md` — coupling, oversized-service, HMAC, persistence, and regression risks relevant to extraction.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/server/services/mioBridgeService.ts`: current orchestration facade and the main source for conversion/update behavior to move behind `MioBridgeCore`.
- `frontend/src/server/services/mihomoService.ts`: existing subscription conversion, artifact validation, and external-binary integration behavior.
- `frontend/src/server/services/nodeManager.ts`: current node aggregation and Agent communication behavior; only the framework-independent aggregation/client portion belongs in core.
- `frontend/src/server/services/stateStore.ts`: cwd-independent file/Redis state abstraction and path-containment behavior to preserve or adapt.
- `frontend/src/server/services/runtimePaths.ts`: canonical runtime path policy and `MIOBRIDGE_CONFIG_DIR` behavior.
- `frontend/src/server/middleware/hmac.ts` and `agent/src/hmac.ts`: existing HMAC protocol behavior that extracted Agent communication must preserve while avoiding unrelated protocol redesign.

### Established Patterns
- Services use `XxxService.getInstance()` facades; the new package may retain compatible facades while establishing `MioBridgeCore` as its public composition root.
- API routes under `frontend/src/pages/api/**` are thin boundaries that validate HTTP input, call services, log failures, and translate results to `ApiResponse` payloads.
- SSR pages call services directly in `getServerSideProps` and must not self-call internal HTTP endpoints.
- Node-only modules stay out of client bundles, and `frontend/src/instrumentation.ts` preserves its `NEXT_RUNTIME === 'nodejs'` dynamic-import guard.

### Integration Points
- Existing API routes and SSR loaders switch from frontend-owned implementations to imports from `packages/core/` or temporary deprecated re-exports.
- The root Bun workspace must include `packages/core/`, while active frontend lint/typecheck/build commands remain frontend-scoped where required.
- Compatibility rewrites `/subscription.txt`, `/clash.yaml`, `/raw.txt`, and `/health` continue to terminate at thin Next.js adapters backed by the shared core.
- The compiled child Agent under `agent/` remains a separate runtime; core consumes its public HMAC HTTP contract rather than absorbing the Agent executable.

</code_context>

<specifics>
## Specific Ideas

- The user explicitly rejected keeping the core under `frontend/src/server/**` and selected `packages/core/` as the durable package boundary.
- `MioBridgeCore` should make the lightweight CLI and optional Dashboard peers that consume one core, rather than making the CLI depend on the web application.
- Migration should be controlled: consumers switch now, while deprecated re-exports protect existing import paths without preserving a second implementation.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-headless-core-boundary*
*Context gathered: 2026-07-12*
