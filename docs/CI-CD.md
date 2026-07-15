# CI/CD

Keep this document short; workflow files are the source of truth.

## Workflows

- `ci.yml`: PR gate. Runs lint; core/frontend typechecks; core, frontend, and
  Agent tests; CLI typechecks/contracts; builds the Vite SPA; cross-compiles and
  inspects x64/arm64 CLI archives and Agent binaries; packages the static
  dashboard provider; and checks the browser bundle boundary.
- `cli-systemd-e2e.yml`: PR and manual Linux gate. It starts a disposable
  systemd host, enables linger for a disposable user, runs compiled CLI
  dashboard start/stop/status across separate shells, verifies all compatibility
  URLs, provider-failure journal guidance, and headless status after provider
  removal. It never tests or creates a root system service.
- `release.yml`: tags package both Linux architectures, run CLI contracts and a
  real user-systemd install, then upload CLI archives, Agent binaries, the POSIX
  `install-agent.sh`, and `SHA256SUMS` to GitHub Releases.

Production deploys are handled by Vercel Git Integration, not GitHub Actions.
The old SSH/systemd `deploy.yml` and `health-check.yml` workflows were removed.

## Local Equivalents

```bash
bun run lint
bun run core:typecheck
bun run core:test
bun run typecheck
bun run cli:typecheck
bun run cli:test
bun run --cwd packages/frontend test
bun run --cwd agent test
bun run build
```

## Deployment Secrets

No GitHub Actions deployment secrets are required for production. Keep Vercel
project settings and production environment variables in the Vercel dashboard.
The CLI release workflow needs only GitHub's `contents: write` permission to
publish already checksum-verified artifacts; it does not deploy Vercel.
