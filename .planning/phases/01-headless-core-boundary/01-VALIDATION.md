---
phase: 1
slug: headless-core-boundary
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-12
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.9 through the existing Bun workspace |
| **Config file** | `frontend/vitest.config.ts`; `packages/core` config is created in Wave 0 |
| **Quick run command** | `bun run --cwd packages/core test --run` |
| **Full suite command** | `bun run lint && bun run typecheck && bun run --cwd packages/core test && bun run --cwd frontend test && (cd agent && bun test) && bun run build` |
| **Estimated runtime** | ~180 seconds |

---

## Sampling Rate

- **After every task commit:** Run the affected core/frontend test file plus `bun run --cwd packages/core typecheck`
- **After every plan wave:** Run all core tests and affected frontend Vitest tests
- **Before `$gsd-verify-work`:** Full suite and non-repository-cwd headless smoke must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | CORE-01 | — | Core import has no Next runtime dependency | unit + integration | `bun run --cwd packages/core test --run test/headless-core.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | CORE-03 | T-01 | Resolved state paths cannot escape the configured base | unit | `bun run --cwd packages/core test --run test/runtime-paths.test.ts` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 2 | CORE-01 | T-04 | Binary execution uses resolved executable paths and fixture-controlled arguments | fixture + contract | `bun run --cwd packages/core test --run test/artifact-equivalence.test.ts test/mihomo-adapter.test.ts` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 2 | CORE-02 | T-02, T-03 | Agent secrets are not exposed and remote payloads are validated before aggregation | integration | `bun run --cwd packages/core test --run test/agent-client.test.ts test/node-aggregation.test.ts` | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 3 | CORE-02 | — | Frontend consumers use the shared core and old modules only re-export | boundary + frontend integration | `bun run --cwd frontend test --run src/server/__tests__/core-boundary.test.ts` | ❌ W0 | ⬜ pending |
| 1-03-02 | 03 | 3 | CORE-01, CORE-02, CORE-03 | T-01–T-04 | Full compatibility and packaging gates pass | smoke + build | `bun run lint && bun run typecheck && bun run --cwd packages/core test && bun run --cwd frontend test && (cd agent && bun test) && bun run build` | ✅ | ⬜ pending |

Threat references:

- **T-01:** runtime-state path traversal or cwd-dependent state selection
- **T-02:** HMAC secret, signature, credential, or proxy URL leakage
- **T-03:** unvalidated/unbounded remote Agent payloads corrupting aggregation
- **T-04:** process argument or executable-path injection at binary boundaries

---

## Wave 0 Requirements

- [ ] `packages/core/package.json`, `packages/core/tsconfig.json`, and core Vitest configuration/scripts
- [ ] `packages/core/test/fixtures/` with representative sources, expected artifacts, node YAML, Agent payloads, and partial-failure results captured before migration
- [ ] `packages/core/test/runtime-paths.test.ts` for changed-cwd, containment, and env-isolation behavior
- [ ] `packages/core/test/headless-core.test.ts` proving no Next server/import is required
- [ ] `packages/core/test/artifact-equivalence.test.ts` for raw/Base64/Clash and partial-failure parity
- [ ] `packages/core/test/agent-client.test.ts` and `packages/core/test/node-aggregation.test.ts` for the HMAC/main-child contract
- [ ] `packages/core/test/mihomo-adapter.test.ts` for managed binary lookup outside repository cwd
- [ ] `frontend/src/server/__tests__/core-boundary.test.ts` preventing duplicate implementations and frontend imports from core
- [ ] Root scripts for core test/typecheck without replacing the frontend-scoped typecheck gate

---

## Manual-Only Verifications

All phase behaviors have automated verification. A live mihomo smoke may be added when a verified binary is available, but fixture/fake-binary coverage is required and sufficient for the phase gate.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
