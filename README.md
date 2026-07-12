# MioBridge

[简体中文](./README.zh-CN.md)

> A distributed subscription converter and control plane powered by mihomo.
> MioBridge aggregates sing-box, Xray, and V2Ray node sources into
> Clash-compatible outputs with an SSR dashboard, remote Agent support, and
> Vercel production deployment.

MioBridge deploys as a single Next.js full-stack service. Its framework-independent
Node backend is the private Bun workspace package `@miobridge/core`; the dashboard,
thin API/SSR boundaries, scheduled jobs, logging, and SSH/deployment adapters live
under `frontend/`. Production runs the Next standalone output directly, with no
separate Express server.

## Highlights

- **Multi-protocol aggregation**: vless, vmess, trojan, hysteria2, tuic, shadowsocks
- **Clash-compatible outputs**: `raw.txt`, `subscription.txt`, and `clash.yaml`
- **Distributed nodes**: remote nodes expose source URLs through a lightweight Agent
- **Multi-kernel Agents**: one child can monitor sing-box, Xray, and V2Ray together
- **HMAC control plane**: the main node talks to Agents over signed HTTP requests
- **SSR dashboard**: Next.js Pages Router UI using the Botanical Garden theme
- **Scheduled refresh**: automatic subscription updates plus manual API/UI triggers
- **Vercel deployment**: Vercel Git Integration deploys pushes to production

## Stack

| Layer | Tech |
| --- | --- |
| Runtime | Node.js 18+ in production, Bun for development and builds |
| App | Next.js Pages Router, Node runtime, standalone output |
| UI | React, Tailwind CSS, Botanical Garden design tokens |
| Conversion | mihomo |
| Config | YAML files under `~/.config/miobridge` |
| Agent | Bun-compiled remote node service |
| Deploy | Vercel, GitHub Actions |

## Quick Start

```bash
git clone https://github.com/imal1/MioBridge.git
cd MioBridge
bun install
bun run dev
```

Open `http://localhost:3001`.

Production build and standalone start:

```bash
bun run build
bun run start
```

Runtime config and generated files live outside the repository:

```text
~/.config/miobridge/
  config.yaml
  nodes.yaml
  raw.txt
  subscription.txt
  clash.yaml
  log/
  bin/
```

## Common Commands

```bash
bun run lint
bun run core:test
bun run core:typecheck
bun run typecheck
bun run build
cd frontend && bun run test
cd agent && bun test
```

Build the remote Agent binary:

```bash
cd agent
bun build src/server.ts --compile --target=bun-linux-x64 --outfile miobridge-agent
```

## Multi-kernel Agents

When adding or editing a child node, MioBridge first detects sing-box, Xray,
and V2Ray over SSH. The selection dialog shows the installed version and
default configuration path for each kernel. Select at least one kernel;
selected missing kernels are installed during deployment, while installed but
unselected kernels remain visible as unmonitored.

The Agent config uses an ordered `kernels` list, so one child can publish
structured sources from several runtimes:

```yaml
kernels:
  - type: xray
    configPath: /usr/local/etc/xray/config.json
  - type: v2ray
    configPath: /etc/v2ray/config.json
```

Detection, monitoring, and health are separate states. Detection means an
executable was found; monitoring means the kernel was selected in the Agent
config; health means its configuration files were readable and its sources
could be extracted. The dashboard reports these states, configuration paths,
errors, and proxy counts independently for every supported kernel.

During aggregation, raw URLs keep their original names. Names used for the
Clash subscription are prefixed with the child node's `location`. If multiple
sources still produce the same name, MioBridge appends the source URL in
brackets so every generated proxy name remains unique.

## Public Endpoints

| Endpoint | Purpose |
| --- | --- |
| `/` | SSR dashboard |
| `/api/health` | health check |
| `/api/status` | service status |
| `/api/update` | trigger subscription refresh |
| `/api/convert` | convert supplied subscription content |
| `/subscription.txt` | base64 subscription output |
| `/clash.yaml` | Clash YAML output |
| `/raw.txt` | raw node list output |

Compatibility paths are served by Next rewrites, so public URLs stay stable
while implementation remains inside API routes.

## Project Layout

```text
frontend/
  src/pages/                 Next pages and API routes
  src/server/                Next composition and operations adapters
  src/components/            dashboard UI
  next.config.js             standalone output and rewrites
packages/core/               headless config, state, conversion, artifacts, nodes
agent/                       remote node Agent
scripts/                     install, manage, and deploy helpers
docs/                        deployment and operations documentation
.github/workflows/           CI/CD workflows
```

`MioBridgeCore` is the headless composition facade. Agent HTTP/HMAC access, the
node repository, and node aggregation are core APIs. SSH, remote installation,
systemd changes, deployment callbacks, and dashboard lifecycle remain
frontend-owned operations.

## Deployment

Production deployments are normally triggered by pushing `main`. Vercel Git
Integration builds the connected project and promotes the production deployment.

Detailed setup is in [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md). CI/CD notes are
in [docs/CI-CD.md](./docs/CI-CD.md).

## Operations

Useful production checks:

```bash
curl -fsS https://miobridge.vercel.app/api/health
```

For troubleshooting, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

## License

MIT
