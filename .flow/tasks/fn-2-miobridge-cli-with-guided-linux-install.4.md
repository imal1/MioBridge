---
satisfies: [R4, R5]
---
## Description
Define a framework-neutral, versioned dashboard provider manifest and implement dashboard install discovery plus foreground execution without making the dashboard a CLI dependency.

**Size:** M
**Files:** `packages/cli/src/dashboard/provider.ts`, `packages/cli/src/dashboard/foreground.ts`, `packages/cli/test/dashboard/**`, `scripts/package-dashboard-provider.sh`

## Approach
- Manifest declares schema version, dashboard version, artifact root, entrypoint/args, environment contract, and health/compatibility URLs.
- Validate containment and executable/entrypoint existence; never execute arbitrary paths outside the provider root.
- Foreground command passes host/port/config paths, forwards signals/exit code, and reports missing/incompatible providers clearly.
- Package the current Next standalone tree as one provider implementation while keeping manifest/launcher independent of Next.

## Investigation targets
**Required**:
- `scripts/prepare-standalone.sh:4-32` — complete current dashboard artifact layout.
- `frontend/next.config.js:15-36` — standalone and compatibility URL contracts.
- `frontend/src/server/applicationRoot.ts` — current artifact root resolution.
- `scripts/manage.sh:128-153` — current server environment contract.
- `docs/DEPLOYMENT.md` — self-hosted versus Vercel boundary.

## Acceptance
- [ ] Versioned manifest validation rejects traversal, unknown schema, missing entrypoints, and invalid URLs.
- [ ] Foreground lifecycle runs the current provider with correct host/port/config environment and forwards signals/status.
- [ ] Missing or removed dashboard returns actionable errors without affecting headless CLI commands or runtime data.
- [ ] Provider smoke tests serve health plus all compatibility URLs and establish a fn-4-replaceable contract.

## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
