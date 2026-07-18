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
bun run e2e:typecheck
bun run e2e
```

The Playwright gate installs its pinned Chromium build, runs the loopback-only
Dashboard fixture with one worker, and uploads HTML, JSON, JUnit, screenshots,
videos, and traces even when a test fails.

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

## 2026-07-15 — Release is gated by a real Linux install

The release workflow now verifies the compiled x64 version, installs the staged
archive through `install.sh`, and runs the user-systemd lifecycle E2E before
uploading assets. The standalone E2E also runs on `main`; container fixtures use
`/root` because `/tmp` is mounted as tmpfs and is unsuitable for `docker cp`.
The same release also publishes checksum-covered Agent binaries for Linux x64
and arm64 so remote nodes never build Agent source. Frontend tests use one
Vitest worker so resource contention cannot turn module imports into
nondeterministic five-second timeouts.

## 2026-07-15 — Product releases follow roadmap milestones

The shipped distributed-control-plane milestone is roadmap v1.0, so its first
semantic GitHub Release is `v1.0.0`. Workspace package versions, compiled CLI
and Agent fallbacks, docs, tags, and Release assets must use that same version.

## 2026-07-16 — Child Agent installer is a release asset

Release packaging and `release.yml` syntax-check, checksum-check, and upload
`install-agent.sh` beside the x64/arm64 Agent gzip files. The main CLI archive
layout is unchanged.
