# Deployment

Production runs on Vercel at `https://miobridge.vercel.app/`.

## Runtime

- App: static Vite SPA built from `packages/frontend/`
- Runtime: Vercel static hosting with SPA fallback to `index.html`
- Project link: `.vercel/project.json`
- Public page check: `https://miobridge.vercel.app/`

The hosted SPA is a UI artifact only. Operational API routes, generated
subscriptions, runtime configuration, and persistence belong to a self-hosted
`miobridge` CLI dashboard process.

## Normal Flow

Production deployments are handled by Vercel Git Integration:

1. Push to `main`.
2. Vercel detects the connected GitHub repository update.
3. Vercel installs dependencies, builds the project, and publishes production.

GitHub Actions no longer deploys production and no longer needs SSH deployment
secrets or a Vercel CLI token.

## Local Verification

```bash
bun install
bun run lint
bun run core:typecheck
bun run core:test
bun run typecheck
bun run build
```

## Checks

```bash
curl -fsS https://miobridge.vercel.app/
```

Use the Vercel dashboard for deployment status, build logs, rollbacks, and
project settings. Use `miobridge dashboard start` for a functional self-hosted
control plane.

## Self-hosted Linux CLI

This Vercel deployment guide does not install or manage a Linux dashboard
daemon. The self-contained `miobridge` release CLI and bundled static provider
are documented in [CLI.md](./CLI.md). They retain state under the user's
`~/.config/miobridge` and do not alter the hosted SPA.
