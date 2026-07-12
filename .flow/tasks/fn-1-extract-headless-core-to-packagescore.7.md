---
satisfies: [R5, R8]
---

## Description

Finish the extraction by wiring core gates into CI and contributor commands, verifying the production standalone artifact end-to-end, and updating architecture, operations, contributor, and project-memory documentation.

**Size:** M
**Files:** `.github/workflows/ci.yml`, `scripts/prepare-standalone.sh`, `README.md`, `README.zh-CN.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/**`, `.Codex/memory/**`

## Approach

- Integrate the existing root `core:test`, `core:typecheck`, and `core:build` commands from task .1 into CI and aggregate gates alongside existing frontend and Agent checks.
<!-- Updated by plan-sync: fn-1-extract-headless-core-to-packagescore.1 already wired the independent root core commands -->
- Perform a clean build, verify traced core/assets and copied `.next/static`/`public`, start the standalone server, and request all four compatibility URLs.
- Re-run the clean standalone build against the actual frontend composition root at `frontend/src/server/core.ts`; task .6 already proved `bun run build` succeeds without `transpilePackages` and that `.next/static` contains no `@miobridge/core`, `MioBridgeCore`, or Node-runtime markers. Preserve that bundle scan as an explicit final gate before the HTTP smoke test.
<!-- Updated by plan-sync: fn-1-extract-headless-core-to-packagescore.6 established frontend/src/server/core.ts and proved the production/client-bundle boundary -->
- Treat `core:test` as the headless package gate: it builds compiled ESM first and includes external-cwd Bun and Node facade smoke coverage for config, generation, update, and status. Keep the standalone HTTP verification as the frontend integration gate.
<!-- Updated by plan-sync: fn-1-extract-headless-core-to-packagescore.5 added compiled external-runtime facade coverage -->
- Update documentation only after final command and package shapes are known.
- Document the focused node boundary: Agent HTTP/HMAC, node repository, and aggregation are core APIs, while `NodeOperationsAdapter` and SSH/deployment lifecycle remain frontend-owned.
<!-- Updated by plan-sync: fn-1-extract-headless-core-to-packagescore.4 split node runtime and operations ownership -->
- Record the new canonical boundary and remove the stale convention that sends business logic to `frontend/src/server`.

## Investigation targets

**Required** (read before coding):
- `.github/workflows/ci.yml:30-88` — current frontend-only checks.
- `scripts/prepare-standalone.sh:5-22` — runtime copy behavior.
- `frontend/src/server/core.ts` — actual Node-only composition adapter and compiled `@miobridge/core` consumer that standalone tracing must include server-side only.
- `README.md:10-36,69-77,132-144` — current monolith description and structure.
- `AGENTS.md:7-19,31-44` — architecture and command rules to supersede.
- `docs/CI-CD.md:5-18` — documented CI gates.
- `.Codex/memory/coding-conventions.md:11` — stale server-location convention.

**Optional** (reference as needed):
- `docs/DEPLOYMENT.md:5-35` — RuntimePaths/standalone deployment wording.

## Acceptance

- [ ] CI and documented root commands run core test/typecheck plus existing lint, frontend typecheck/tests/build, and Agent tests as appropriate.
- [ ] A clean standalone build contains the core package and required assets; its running server successfully serves all compatibility URLs.
- [ ] English/Chinese READMEs, AGENTS, contributing, CI/CD, and affected deployment docs describe the actual workspace architecture and commands.
- [ ] Project architecture and coding-convention memory reflect `packages/core`; any materially changed CI/deployment/config conventions are updated in their matching memory files.

## Done summary
Wired core/frontend/Agent CI gates, standalone trace and live compatibility smoke verification, and updated workspace architecture documentation and durable memory.
## Evidence
- Commits:
- Tests: bun run core:test (26 passed), bun run core:typecheck, bun run lint, bun run typecheck, bun run --cwd frontend test (324 passed), bun run --cwd agent test (29 passed), bun run clean && bun run build, standalone client-bundle boundary scan, standalone live HTTP smoke: /subscription.txt, /clash.yaml, /raw.txt, /health all 200, CI YAML parse and git diff --check
- PRs: