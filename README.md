# MioBridge

[简体中文](./README.zh-CN.md)

> A distributed subscription converter and control plane powered by mihomo.
> MioBridge aggregates sing-box, Xray, and V2Ray node sources into
> Clash-compatible outputs with a SPA dashboard, remote Agent support,
> and a single-binary Linux CLI.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/imal1/MioBridge/main/scripts/install.sh | bash
```

The bootstrap installs the verified Linux CLI and its static dashboard, then
the CLI installs pinned runtime dependencies. It does not clone or build the
source tree. Runtime files live under `~/.config/miobridge/`.

## CLI

```bash
miobridge update              # refresh subscription
miobridge status --json       # print service status
miobridge dashboard start     # serve dashboard + API on :3000
miobridge dashboard stop      # stop the dashboard server
miobridge dashboard status    # check if dashboard is running
miobridge upgrade             # install the latest verified CLI release
miobridge --help              # list all commands
```

The `dashboard` command starts a single process that serves the static Vite
SPA and API routes. It needs no Node.js runtime or separate web server.

## Uninstall

```bash
miobridge dashboard stop
miobridge uninstall           # preserve config, data, logs, and backups
miobridge uninstall --purge   # also remove config, data, and managed dependencies
```

## Development

```bash
git clone https://github.com/imal1/MioBridge.git
cd MioBridge
bun install

# Terminal 1: dashboard (Vite dev server, port 5173)
bun run dev

# Terminal 2 from the repository root: CLI server (port 3000)
bun run core:build
bun packages/cli/src/main.ts dashboard foreground

# Tests
bun run core:test
bun run cli:test
bun run --cwd packages/frontend test
bun run --cwd agent test
```

## Stack

| Layer | Tech |
| --- | --- |
| CLI | Bun-compiled single binary |
| Core | `@miobridge/core` (headless config, state, conversion, artifacts) |
| Dashboard | Vite React SPA, React Router, Botanical Garden tokens |
| Conversion | mihomo |
| Agent | Bun-compiled remote node service |
| Config | YAML under `~/.config/miobridge/` |

## Public Endpoints

| Endpoint | Purpose |
| --- | --- |
| `/` | SPA dashboard |
| `/health` | health check |
| `/api/status` | service status |
| `/api/update` | trigger subscription refresh |
| `/api/convert` | convert supplied subscription content |
| `/subscription.txt` | base64 subscription output |
| `/clash.yaml` | Clash YAML output |
| `/raw.txt` | raw node list output |

## Project Layout

```text
packages/cli/                CLI binary, dashboard server, HTTP and SSH adapters
packages/core/               headless config, state, conversion, artifacts
packages/frontend/            Vite React SPA (static bundle consumed by CLI)
agent/                       remote node Agent
scripts/                     installer, release packaging, and E2E helpers
docs/                        deployment and operations documentation
```

`MioBridgeCore` is the headless composition facade. The CLI server wraps it
with thin HTTP adapters and serves the static Vite bundle from `packages/frontend/dist/`.
The dashboard is a browser-only SPA that talks to the CLI over typed HTTP
clients. The CLI binary owns the API and static-file server.

## Multi-kernel Agents

When adding or editing a child node, MioBridge first detects sing-box, Xray,
and V2Ray over SSH. The selection dialog shows the installed version and
default configuration path for each kernel. Select at least one kernel;
selected missing kernels are installed during deployment, while installed but
unselected kernels remain visible as unmonitored.

The CLI selects a same-version x64/arm64 Agent Release asset for the child,
verifies it against `SHA256SUMS`, and installs it without Git, Bun, or a source build.

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

## Operations

```bash
curl -fsS http://localhost:3000/health
miobridge status --json
```

For troubleshooting, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

## License

MIT
