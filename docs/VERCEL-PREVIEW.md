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

## Child-node Agent bootstrap

Child nodes use the separate `install-agent.sh` release asset. It installs only
the checksum-verified x64/arm64 Agent binary under `~/.local/bin`, its config
under `~/.config/miobridge-agent`, and a `systemctl --user` service. It needs no
sudo. It does not install the main CLI, Dashboard, Bun, mihomo, or a protocol
kernel, and it does not register a node in the control plane.

Download `agent.yaml` from the Dashboard deployment center, copy it to the child,
then run:

```bash
scp agent.yaml child:/tmp/miobridge-agent.yaml

curl -fsSL \
  https://github.com/imal1/miobridge/releases/latest/download/install-agent.sh \
  -o /tmp/install-agent.sh

sh /tmp/install-agent.sh --config /tmp/miobridge-agent.yaml
```

The installer verifies `SHA256SUMS`, runs the binary's `--version` and
`--check-config`, atomically replaces owned files, reloads and restarts systemd,
then verifies the local `/health` endpoint. A failed replacement, service start,
or health check restores the previous binary, config, and unit. Re-running the
same version is an idempotent reinstall/repair.

For an offline mirror or a config assembled on the child:

```bash
sh install-agent.sh \
  --version 1.0.0 \
  --base-url https://mirror.example/miobridge/v1.0.0 \
  --node-id node-child \
  --node-name "Child node" \
  --secret-file "$HOME/.config/miobridge-agent.secret" \
  --kernel sing-box:/etc/sing-box/config.json \
  --port 3001
```

Omit every `--kernel` to generate `kernels: []`. Plaintext `--secret` is not
accepted. After installation, runtime maintenance belongs to the Dashboard/API;
the shell script remains a bootstrap and repair entrypoint only.

Dashboard Agent deployment has the same boundary: it includes only kernels that
are already installed and readable, and never installs a selected-but-missing
kernel. Protocol-kernel install and maintenance remain explicit operations.
233boy installation runs the corresponding upstream `install.sh` directly, and
lifecycle commands run their global wrapper directly first. An explicit
permission/root error retries the same command with elevation; protocol kernels
do not have a separate rootless installation layout.
