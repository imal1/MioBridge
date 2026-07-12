---
satisfies: [R3, R7]
---

## Description

Extract source normalization plus sing-box and mihomo kernel/conversion adapters into core, using injected paths, logging, process, and filesystem collaborators while preserving conversion and binary-discovery behavior.

**Size:** M
**Files:** `packages/core/src/artifacts/source*.ts`, `packages/core/src/kernels/**`, `packages/core/test/kernels/**`, `frontend/src/server/services/singBoxService.ts`, `frontend/src/server/services/mihomoService.ts`

## Approach

- Preserve existing proxy protocol validation, exact-URL deduplication, kernel tags, errors, conversion arguments, and mihomo-required semantics.
- Replace cwd-derived binary candidates by consuming `RuntimePaths.binaryCandidates(name)`, whose implemented order is managed-bin, explicit application-root repo-bin, then PATH.
<!-- Updated by plan-sync: fn-1-extract-headless-core-to-packagescore.2 implemented binary precedence through RuntimePaths.binaryCandidates(name) -->
- Keep process execution injectable and redact credentials/full proxy URLs from diagnostics.
- Leave deprecated frontend re-exports only after consumers move in task .6.

## Investigation targets

**Required** (read before coding):
- `frontend/src/server/services/proxySources.ts` — normalization, dedup, and Clash naming.
- `frontend/src/server/services/singBoxService.ts` — source discovery contract.
- `frontend/src/server/services/mihomoService.ts:39-66` — singleton and cwd-dependent binary candidates.
- `frontend/src/server/services/__tests__/mihomoService.test.ts` — health/conversion behavior.
- `frontend/src/server/services/__tests__/proxySources.test.ts` — equivalence cases.

**Optional** (reference as needed):
- `frontend/src/server/services/adapters/kernelAdapter.ts` — existing kernel adapter shape.
- `frontend/src/server/types/__tests__/types.test.ts` — protocol validation cases.

## Acceptance

- [ ] Kernel/source adapters have no frontend imports and use injected runtime/process/logging collaborators.
- [ ] Binary lookup tests cover managed, explicit repository, and PATH precedence from multiple working directories.
- [ ] Existing conversion arguments, errors, mihomo availability rules, protocol set, deduplication, and redaction remain unchanged.
- [ ] Golden source/conversion tests pass against the extracted adapters.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
