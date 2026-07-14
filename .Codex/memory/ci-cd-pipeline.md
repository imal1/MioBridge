---
name: ci-cd-pipeline
description: CI/CD workflow decisions and operational notes for MioBridge
metadata:
  type: project
---

# CI/CD Pipeline

## 2026-07-02 — Production deploys to Vercel

Production deploys now use Vercel Git Integration, not GitHub Actions deploy
steps. Pushes to `main` should be built and published by the connected Vercel
project. GitHub Actions no longer uses SSH, tarball upload, server symlink
switching, systemd restart, or Vercel CLI.

The old SSH `deploy.yml` and scheduled SSH `health-check.yml` workflows were
removed.

## 2026-07-14 — Workspace-local checks

Each active package owns its TypeScript configuration; the unused root server
configuration has been removed.

Current PR gate:

```bash
bun run lint
bun run core:typecheck
bun run core:test
bun run typecheck
bun run cli:typecheck
bun run cli:test
bun run --cwd packages/frontend test
bun run --cwd agent typecheck
bun run --cwd agent test
bun run build
```

The build gate builds the Vite SPA, packages its static provider, and rejects
Node/core markers in client chunks. CLI systemd E2E owns live compatibility URL
checks.

## 2026-07-12 — Linux CLI release and user-systemd gates

`ci.yml` now type-checks/tests `packages/cli`, cross-compiles and inspects
checksum-covered Linux x64/arm64 archives, and packages the dashboard provider.
`cli-systemd-e2e.yml` runs the compiled CLI in a disposable Linux systemd host
with explicit linger, separate-shell reconnect, idempotent lifecycle, four URL
smoke checks, failure journal guidance, and provider-removal headless status.
Tag-only `release.yml` uploads the two archives plus `SHA256SUMS`; Vercel
production deployment remains Git Integration.

## 2026-07-14 — Release version is embedded in the CLI

`package-cli-release.sh` injects the requested release version during Bun
compilation and includes the Vite provider in each architecture archive.
Installer, self-upgrade validation, and `miobridge --version` share the same
release identity. Manual `release.yml` dispatches create the version tag and
GitHub Release instead of building assets without publishing them.
