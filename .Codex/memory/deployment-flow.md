---
name: deployment-flow
description: Current deployment flow notes
metadata:
  type: project
---

# Deployment Flow

- Production runs on Vercel at `https://miobridge.vercel.app/`.
- Vercel Git Integration builds and publishes production when `main` is pushed.
- Vercel Linux builds run `scripts/ensure-mihomo-binary.mjs`, writing
  `packages/frontend/bin/mihomo`; Next `outputFileTracingIncludes` bundles it into
  server functions.
- GitHub Actions is a CI gate only; it does not deploy and does not install or
  run Vercel CLI.
- `packages/frontend/next.config.js` enables `output: 'standalone'` only outside Vercel;
  Vercel uses its native Next.js builder output.
- The old server main-node flow, systemd restart, SSH upload, symlink switch,
  and scheduled SSH health check are no longer used for production.
- Child deployment detects every supported kernel, lets operators choose the
  monitored set, installs selected missing kernels, then deploys one Agent config.
- New nodes persist as empty-kernel drafts; successful or partial deployments
  atomically commit only monitored kernels. Deployment IDs prevent stale jobs
  from overwriting newer node or progress state.
- Remote Agent config and systemd unit replacement use checked same-directory
  temporary files and atomic moves; sudo passwords travel through SSH stdin.
