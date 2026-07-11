# Testing Patterns

**Analysis Date:** 2026-07-11

## Test Framework

**Runner:**
- Vitest 4.1.9 for the Next.js application.
- Config: `frontend/vitest.config.ts`
- Bun's built-in test runner for the standalone agent; tests import from `bun:test`.
- Config: `agent/tsconfig.json` (no separate Bun test configuration detected)

**Assertion Library:**
- Vitest's `expect` for frontend server, API, hook, and component tests.
- `@testing-library/react` plus `@testing-library/jest-dom` for React behavior and DOM assertions.
- Bun's `expect` from `bun:test` for `agent/src/__tests__/**`.

**Run Commands:**
```bash
cd frontend && bun run test          # Run all frontend Vitest tests once
cd frontend && bun run test:watch    # Run frontend Vitest in watch mode
cd agent && bun test                 # Run all standalone agent tests
```

## Test File Organization

**Location:**
- Tests are co-located by subsystem in `__tests__/` directories beneath `frontend/src/` and `agent/src/`.
- Service tests live in `frontend/src/server/services/__tests__/`; API tests live in `frontend/src/server/__tests__/api/`; component tests live in `frontend/src/components/cluster/__tests__/`.
- Cross-module runtime and type tests live in `frontend/src/__tests__/`, `frontend/src/server/__tests__/`, and `frontend/src/server/types/__tests__/`.

**Naming:**
- Use `<subject>.test.ts` for backend, API, utility, and agent tests.
- Use `<behavior>.test.tsx` for React components and workflows.
- Vitest also accepts `.spec.ts` and `.spec.tsx` through `frontend/vitest.config.ts`, but current tests use `.test.*`.

**Structure:**
```
frontend/src/<area>/__tests__/<subject>.test.ts[x]
frontend/src/server/__tests__/api/<route-or-feature>.test.ts
agent/src/__tests__/<subject>.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('FileStateStore', () => {
  beforeEach(() => {
    resetStateStoreForTests();
  });

  afterEach(() => {
    resetStateStoreForTests();
    vi.restoreAllMocks();
  });

  it('round-trips values as files under the config dir', async () => {
    const store = getStateStore();
    await store.set('nodes.yaml', 'nodes:\n');
    expect(await store.get('nodes.yaml')).toBe('nodes:\n');
  });
});
```

**Patterns:**
- Group by exported unit, route, or visible workflow with `describe`; use nested suites when a module has multiple implementations.
- Reset singleton state, environment overrides, and mocks in `beforeEach`/`afterEach`; never let process-wide mutations leak between tests.
- Phrase test names as observable behavior, including the failure or concurrency condition being protected.
- Assert results and important side effects (file mode, call order, HTTP status, cleanup), not implementation details alone.
- Use real temporary directories for filesystem contracts and remove them during teardown.

## Mocking

**Framework:** Vitest mocks (`vi.fn`, `vi.mock`, `vi.spyOn`, `vi.stubGlobal`) and explicit injected callbacks; Bun tests use lightweight request/config fixtures and real local file operations.

**Patterns:**
```typescript
const getRemoteLogs = vi.fn();

vi.mock('@/server/services/nodeManager', () => ({
  NodeManager: {
    getInstance: () => ({ getRemoteLogs }),
  },
}));

beforeEach(() => {
  getRemoteLogs.mockReset();
});
```

**What to Mock:**
- Mock network calls, SSH execution, subprocess/binary invocation, cron scheduling, time-sensitive globals, and singleton collaborators at the module boundary.
- Mock service methods for thin API route tests so status codes and response shapes are isolated.
- Inject `detectKernels`, `createNode`, and `deployNode` callbacks for component workflow tests, following `frontend/src/components/cluster/__tests__/add-node.test.tsx`.
- Use `vi.hoisted` when mock functions must be available inside hoisted `vi.mock` factories, as in `frontend/src/__tests__/instrumentation-node.test.ts`.

**What NOT to Mock:**
- Do not mock pure adapters, parsing, validation, HMAC calculations, or state transformations when deterministic real inputs are inexpensive.
- Do not mock the filesystem for permission/path-safety contracts; use a temporary directory as in `frontend/src/server/services/__tests__/stateStore.test.ts`.
- Do not mock Testing Library DOM interactions; render components and drive them through accessible labels, roles, and visible text.

## Fixtures and Factories

**Test Data:**
```typescript
function mockReq(overrides: Partial<NextApiRequest> = {}) {
  return {
    method: 'GET',
    headers: {},
    ...overrides,
  } as NextApiRequest;
}

const config = {
  node: { id: 'node-sg', name: '新加坡', secret: 'test-secret' },
  kernels: [{ type: 'xray', configPath: '/nonexistent/xray.json' }],
};
```

**Location:**
- Small fixtures and request/response factories live at the top of the test file that owns them.
- JSON/kernel configuration fixtures are built by helper functions in `agent/src/__tests__/handlers.test.ts`.
- No shared fixture directory or factory package is detected; create one only after data is genuinely reused across multiple suites.
- Use obviously fake hosts, tokens, UUIDs, and credentials. Never load developer or production credential files in tests.

## Coverage

**Requirements:** None enforced. No coverage threshold, provider configuration, or root aggregation is present.

**View Coverage:**
```bash
cd frontend && bunx vitest run --coverage   # Requires adding a compatible Vitest coverage provider
```

## Test Types

**Unit Tests:**
- Cover services, adapters, middleware, CLI command builders, runtime paths, types, client API helpers, and agent handlers.
- Prefer deterministic inputs and explicit edge cases, especially path traversal, HMAC failures, duplicate events, timeout behavior, and secret cleanup.

**Integration Tests:**
- `frontend/src/server/services/__tests__/deploy-integration.test.ts` exercises orchestration across deployment collaborators with external boundaries controlled.
- API route suites under `frontend/src/server/__tests__/api/` verify handler-to-service contracts using mocked singleton services and request/response doubles.
- `scripts/e2e-distributed.sh` exercises a distributed deployment scenario and `scripts/e2e-browser.mjs` performs browser-oriented smoke coverage outside Vitest.

**E2E Tests:**
- Custom shell/Node scripts are used rather than Playwright or Cypress.
- Run `bun run e2e:distributed` for the distributed flow and `bun run e2e:browser` for the browser flow from the repository root.
- These scripts depend on runtime services/binaries and are not part of the default `frontend` or `agent` unit-test commands.

## Common Patterns

**Async Testing:**
```typescript
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
};

const operation = deferred<Result>();
fireEvent.click(screen.getByRole('button', { name: '检测内核' }));
operation.resolve(result);
await waitFor(() => expect(callback).toHaveBeenCalledOnce());
```

**Error Testing:**
```typescript
await expect(store.get('../outside')).rejects.toThrow('非法的 state key');

service.mockRejectedValue(new Error('SSH 连接失败'));
expect(await screen.findByText('SSH 连接失败')).toBeDefined();
expect(createNode).not.toHaveBeenCalled();
```

**API Route Testing:**
```typescript
const res = mockRes();
await handler({ method: 'GET' } as NextApiRequest, res);
expect(res._status).toBe(200);
expect(res._json).toMatchObject({ success: true });
```

**Environment and Filesystem Isolation:**
- Save only the environment keys a suite changes, delete or replace them in setup, and restore them exactly in teardown.
- Reset cached singleton instances after environment changes so the test observes the intended backend.
- Create temporary directories with `fs.mkdtemp`, assert real file paths/modes, and remove them in `afterEach`.

---

*Testing analysis: 2026-07-11*
