# CI/CD

Keep this document short; workflow files are the source of truth.

## Workflows

- `ci.yml`: PR gate. Runs lint; core/frontend typechecks; core, frontend, and
  Agent tests; then builds and starts the standalone output. The final gate
  checks the traced core package, static assets, browser-bundle boundary, and
  `/subscription.txt`, `/clash.yaml`, `/raw.txt`, and `/health`.

Production deploys are handled by Vercel Git Integration, not GitHub Actions.
The old SSH/systemd `deploy.yml` and `health-check.yml` workflows were removed.

## Local Equivalents

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

## Deployment Secrets

No GitHub Actions deployment secrets are required for production. Keep Vercel
project settings and production environment variables in the Vercel dashboard.
