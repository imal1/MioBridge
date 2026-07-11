# Context

## CI/CD

source: `/Users/imali/Projects/MioBridge/docs/CI-CD.md`

DATA_7QK2M9VX_START

# CI/CD

Keep this document short; workflow files are the source of truth.

## Workflows

- `ci.yml`: PR gate. Runs lint, frontend typecheck, and build.

Production deploys are handled by Vercel Git Integration, not GitHub Actions.
The old SSH/systemd `deploy.yml` and `health-check.yml` workflows were removed.

## Local Equivalents

```bash
bun run lint
bun run typecheck
bun run build
```

## Deployment Secrets

No GitHub Actions deployment secrets are required for production. Keep Vercel
project settings and production environment variables in the Vercel dashboard.

DATA_7QK2M9VX_END

## Deployment

source: `/Users/imali/Projects/MioBridge/docs/DEPLOYMENT.md`

DATA_H4N8C2RY_START

# Deployment

Production runs on Vercel at `https://miobridge.vercel.app/`.

## Runtime

- App: Next.js Pages Router service under `frontend/`
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

DATA_H4N8C2RY_END

