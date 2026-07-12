# Deployment

Production runs on Vercel at `https://miobridge.vercel.app/`.

## Runtime

- App: Next.js Pages Router service under `frontend/`, composing the traced
  `@miobridge/core` workspace package on the server only
- Runtime: Vercel Node.js functions
- Project link: `.vercel/project.json`
- Public health check: `https://miobridge.vercel.app/api/health`

Generated subscription artifacts still use the app runtime paths defined by the
server services. Vercel deployments are ephemeral, so production persistence
should be handled through Vercel-managed environment/config and durable external
storage when that becomes necessary.

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
curl -fsS https://miobridge.vercel.app/api/health
```

Use the Vercel dashboard for deployment status, runtime logs, rollbacks, and
project settings.

The old systemd/Nginx server flow is no longer used for the main node.
