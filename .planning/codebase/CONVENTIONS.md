# Coding Conventions

**Analysis Date:** 2026-07-11

## Naming Patterns

**Files:**
- Use `camelCase.ts` for server modules and hooks, such as `frontend/src/server/services/nodeManager.ts` and `frontend/src/lib/useClusterSSE.ts`.
- Use `PascalCase.tsx` for React components, such as `frontend/src/components/cluster/NodeCard.tsx`.
- Use lowercase route names and Next.js dynamic-segment syntax under `frontend/src/pages/api/`, such as `frontend/src/pages/api/file/[name].ts`.
- Co-locate tests in `__tests__/` and name them after the unit or behavior with `.test.ts` or `.test.tsx`.
- Use kebab-case for shell scripts and design/planning documents, such as `scripts/e2e-distributed.sh` and `docs/superpowers/specs/2026-07-11-multi-kernel-monitoring-design.md`.

**Functions:**
- Use `camelCase` for functions and methods: `getStateStore`, `resetStateStoreForTests`, `handleStatus`, and `withDistributedLock`.
- Prefix accessors and checks with verbs such as `get`, `load`, `save`, `ensure`, `check`, `detect`, `is`, or `has`.
- Name Next.js API route entry points `handler` and export them as default from `frontend/src/pages/api/**`.
- Use `XxxService.getInstance()` for singleton backend services in `frontend/src/server/services/**`; expose behavior through thin API handlers.

**Variables:**
- Use `camelCase` for local variables and object properties.
- Use `UPPER_SNAKE_CASE` for module constants such as `REDIS_KEY_NS`, `REDIS_TIMEOUT_MS`, and `LOCK_TTL_SECONDS` in `frontend/src/server/services/stateStore.ts`.
- Use boolean names that communicate state or capability (`isOpen`, `installed`, `accessible`, `monitored`).
- Use `mockXxx` names for test doubles and `savedXxx` for state restored during teardown.

**Types:**
- Use `PascalCase` for interfaces, type aliases, classes, and React prop types: `StateStore`, `AgentConfig`, `ButtonProps`, and `FileStateStore`.
- Use discriminated string unions for bounded states and `as const` when preserving literals, as in kernel types and store `kind` fields.
- Keep shared backend types in `frontend/src/server/types/index.ts`; keep component-specific props beside their component.

## Code Style

**Formatting:**
- No repository-wide formatter is configured; preserve the style of the file being edited.
- Most server and page code uses single quotes, semicolons, two-space indentation, and trailing commas in multiline constructs.
- Generated/shadcn-derived UI primitives in `frontend/src/components/ui/` use double quotes and frequently omit semicolons; do not mechanically restyle them when making functional edits.
- Keep shell code compatible with Bash and follow the defensive conventions already used in `scripts/lib/*.sh`.
- Run `bun run typecheck` after TypeScript changes; the active application project is `frontend/tsconfig.json`, not the root `tsconfig.json`.

**Linting:**
- Use Oxlint through `bun run lint`; configuration is in `oxlint.json` and scope is `frontend/src/`.
- Treat unused variables, `var`, and missed `const` as errors; `console` use is a warning.
- Prefer the logger in `frontend/src/server/utils/logger.ts` over direct console calls in server code.
- TypeScript strict mode is enabled in `frontend/tsconfig.json` and `agent/tsconfig.json`; avoid introducing unchecked nullable paths or implicit types.
- Existing `any` usage is tolerated but is not a preferred pattern; add concrete request, response, and service result types when touching an API boundary.

## Import Organization

**Order:**
1. Runtime/framework and third-party imports (`react`, `next`, `vitest`, `fs-extra`).
2. Node built-ins (`path`, `crypto`, `os`), normally using `import * as` in server modules.
3. Project alias imports (`@/server/...`, `@/components/...`, `@/lib/...`).
4. Relative imports for same-directory modules and test subjects.

**Path Aliases:**
- Use `@/*` for `frontend/src/*`, configured in `frontend/tsconfig.json` and `frontend/vitest.config.ts`.
- Agent code defines `@adapters/*`, `@middleware/*`, and `@types/*` aliases into shared frontend server modules in `agent/tsconfig.json`.
- Prefer `@/` for cross-area frontend imports; use relative imports for adjacent modules, especially `../stateStore` from co-located tests.
- Use `import type` when an import is type-only, as in `frontend/src/pages/api/health.ts` and `frontend/src/components/ui/button.tsx`.

## Error Handling

**Patterns:**
- Throw `Error` with a user-actionable message in framework-independent services; API routes catch failures and translate them to an HTTP status plus JSON error payload.
- Validate boundary inputs early and return immediately on authentication, method, or payload failure; `frontend/src/pages/api/health.ts` demonstrates the HMAC guard pattern.
- Preserve cleanup with `try/finally` for timers, locks, temporary state, SSH sessions, and credentials. See `RedisStateStore.command` and `withDistributedLock` in `frontend/src/server/services/stateStore.ts`.
- Normalize unknown caught values before accessing messages. Existing code often uses `catch (error: any)`; new code should prefer `unknown` plus an `instanceof Error` guard where practical.
- Use explicit degraded behavior only when availability is the intended policy, and log it. `frontend/src/server/services/stateStore.ts` warns before falling back from a distributed lock.
- Return stable API envelopes and appropriate status codes from `frontend/src/pages/api/**`; do not leak stack traces, secrets, SSH credentials, or private-key contents.

## Logging

**Framework:** Winston for the Next.js service; console-style logging in the compiled Bun agent and scripts where no shared logger is available.

**Patterns:**
- Import `logger` from `frontend/src/server/utils/logger.ts` in Node-only backend modules.
- Use `logger.info` for lifecycle events, `logger.warn` for recoverable degradation, and `logger.error` for failed operations.
- Keep messages contextual (service, node, operation) and redact secrets, HMAC values, passwords, tokens, and private keys.
- Application logs are written below the runtime config directory and rotated by Winston; do not construct cwd-relative log locations.

## Comments

**When to Comment:**
- Explain security invariants, concurrency behavior, compatibility constraints, and non-obvious fallbacks rather than restating syntax.
- Chinese comments are established in backend code and are acceptable when they precisely explain operational behavior, as in `frontend/src/server/services/stateStore.ts`.
- Keep public URL compatibility and runtime-placement constraints documented when changing rewrites, Node-only imports, or standalone deployment behavior.
- Use TODO/FIXME comments only with a concrete follow-up; do not leave speculative placeholders.

**JSDoc/TSDoc:**
- Use JSDoc for public abstractions and methods whose concurrency or persistence contract is not obvious, such as `StateStore.withLock`.
- Most private helpers and React components are self-documenting and do not require JSDoc.

## Function Design

**Size:** Keep API routes thin and move orchestration or I/O into `frontend/src/server/services/**`. Split long service workflows into named private helpers representing one deployment or conversion step.

**Parameters:**
- Use typed object parameters when a function needs several related values; use injected callbacks for UI workflows that require isolated testing.
- Pass dependencies through component props or focused service seams where behavior must be mocked, as demonstrated by `frontend/src/components/cluster/AddNodeForm.tsx`.
- Avoid passing raw credentials beyond the smallest deployment/authentication boundary.

**Return Values:**
- Use `Promise<T>` explicitly for asynchronous service contracts.
- Use `null` for an expected missing persisted value (`StateStore.get`) and throw for operational failure.
- API/client operations use structured success/error objects; keep envelope fields stable for callers and tests.
- Use early returns for guards and failure branches to keep the main success path legible.

## Module Design

**Exports:**
- Default-export Next.js pages and API handlers as required by Pages Router.
- Prefer named exports for services, shared utilities, types, hooks, and UI components.
- Keep backend modules framework-independent under `frontend/src/server/**`; only `frontend/src/pages/api/**` should translate them to Next.js request/response semantics.
- Keep Node-only imports inside `frontend/src/server/**`, `frontend/src/pages/api/**`, or `frontend/src/instrumentation-node.ts`; guard the dynamic import from `frontend/src/instrumentation.ts` with `NEXT_RUNTIME === 'nodejs'`.

**Barrel Files:**
- Barrel usage is limited. `frontend/src/server/types/index.ts` and `frontend/src/server/config/index.ts` are intentional aggregation points.
- Import concrete service modules directly instead of creating broad barrels that obscure server/client boundaries.

---

*Convention analysis: 2026-07-11*
