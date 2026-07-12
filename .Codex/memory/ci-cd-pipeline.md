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

## 2026-07-01 — Type check runs in the Next.js workspace

The repository root still contains a migration-era `tsconfig.json` that points
at root `src/**/*`. The active application lives under `frontend/`, so CI must
run TypeScript checks from that workspace.

Current PR gate:

```bash
bun run lint
bun run core:typecheck
bun run core:test
bun run typecheck
cd frontend && bun run test
cd ../agent && bun test
cd ..
bun run build
```

The build gate also checks the traced core package and static assets, rejects
Node/core markers in client chunks, starts the standalone server, and requests
all four public compatibility URLs.
