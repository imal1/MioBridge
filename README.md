# MioBridge

[Quick start (中文)](docs/QUICKSTART.zh-CN.md) · [Self-hosting](docs/DEPLOYMENT.md) · [FAQ (中文)](docs/FAQ.zh-CN.md)

Dashboard APIs require an administrator session or Bearer token (`miobridge auth show`). New installs protect subscriptions with a separate token (`miobridge subscription url --qr`); `/health` stays public. Legacy installs prompt before enabling subscription protection.

[简体中文](./README.zh-CN.md)

> A distributed subscription converter and control plane powered by mihomo.
> MioBridge aggregates sing-box, Xray, and V2Ray node sources into
> Clash-compatible outputs with a SPA dashboard, remote Agent support,
> and a single-binary Linux CLI.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/imal1/MioBridge/main/scripts/install.sh | bash
```

The bootstrap installs the verified Linux CLI, static dashboard, and pinned
runtime dependencies. By default it registers this server as the local node and
installs the matching user-level Agent. The Agent monitors only protocol kernels
that are already installed and readable; deploying it never installs sing-box,
Xray, or V2Ray. Pass `--no-local-node` to skip the local node and Agent. It does
not clone or build the source tree. Runtime files live under
`~/.config/miobridge/`.

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
| `POST /api/update` | authenticated subscription refresh; GET returns 405 |
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

The node detail's **Agent** tab offers repeatable diagnostics, explicit repair,
and optional migration to a system service. The CLI exposes the same operations:

```bash
miobridge nodes diagnose <node-id> --json
miobridge nodes repair <node-id>
miobridge nodes migrate-service <node-id> --user <existing-non-root-user>
```

Diagnostics distinguish SSH access, Linger, service enablement/running state,
restart count, version and public health. Repair closes SSH and independently
verifies health/version after a stabilization period. System-service migration
requires root or sudo, validates a candidate on a temporary loopback port before
handover, and rolls back failed acceptance. Runtime files belong under the chosen
user's `~/.config/miobridge/`; subsequent operations detect the service mode.
Older Agents without loopback candidate support must be upgraded first. Existing
nodes are never migrated automatically.

Heartbeats show fluctuating, abnormal and offline after 1, 3 and 5 consecutive
failures. Two consecutive successes restore online status while preserving the
last failure reason and time.

Adding a server runs SSH preflight and confirms the host fingerprint. The default flow installs
Agent, detects existing protocol kernels, adopts them and generates the subscription. If none
are found, choose a kernel to install or finish later. Disable the automatic flow to save only
the server record. Editing a record does not reinstall components.

Protocol-kernel lifecycle operations delegate to the upstream 233boy
management scripts (`233boy/sing-box`, `233boy/Xray`, and `233boy/v2ray`).
MioBridge detects the management wrapper at `/usr/local/bin/<kernel>` and uses
the script-managed configuration under `/etc/<kernel>`; a bare upstream core
binary is not treated as a compatible source provider because it has no
`url [name]` command. First installation always invokes the corresponding
upstream `install.sh` directly, while maintenance always calls the global
wrapper directly first. If the upstream installer or wrapper explicitly reports
that root permission is required, MioBridge retries the same command with
elevation; there is no separate rootless kernel layout.

The CLI selects a same-version x64/arm64 Agent Release asset for the child,
verifies it against `SHA256SUMS`, and installs it under the SSH user's home with
a `systemctl --user` service. This requires no sudo, Git, Bun, or source build.

The Agent config uses an ordered `kernels` list, so one child can publish
structured sources from several runtimes:

```yaml
kernels:
  - type: xray
    configPath: /etc/xray/config.json
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

### Subscription endpoint: domain, SNI, and certificate verification

The 233boy management scripts export share links by public IP and always add
skip-verification parameters. After installing a real domain certificate on the
kernel, open **Overview → 订阅出口** in the node detail and set the node's
connection domain, TLS SNI, certificate verification policy, and subscription
display name. The settings are stored in the main node's
`~/.config/miobridge/nodes.yaml` and applied to `raw.txt`, `subscription.txt`,
and `clash.yaml` on every subscription update, so neither an update nor a
dashboard restart restores the old values. Nothing on the child node, in the
233boy scripts, or in generated artifacts needs to be edited.

```yaml
nodes:
  - id: ht
    host: 203.0.113.7            # Agent management address; never changed by these settings
    proxy:
      server: ht.example.com     # address clients connect to
      sni: ht.example.com        # TLS server name
      certVerify: strict         # strict → skip-cert-verify: false; insecure → self-signed
      protocols: [trojan, hysteria2]   # optional; defaults to every protocol of the node
      displayName: HT            # exported as "HT Trojan", "HT Hysteria2"
```

Every field is an explicit choice and an empty field keeps the kernel-reported
value: MioBridge never treats a configured `server_name` as proof that the
certificate is trusted. `sni` and `certVerify` apply only to certificate-based
TLS protocols (Trojan, Hysteria2, TUIC, VLESS/VMess over TLS); Reality and
plaintext protocols are left alone, and ports, passwords, and all other
parameters keep their original values. The display name is written to both the
Clash proxies and the template policy-group references. The API is the `proxy`
field of `PATCH /api/cluster/nodes/{id}`; send `null` to clear it.

On a server without a browser, use the CLI for the same settings. It edits field
by field: only the options you pass change, an empty value (or
`--cert-verify inherit`, `--protocols all`) clears one field, and `--clear`
removes everything. Without options it prints the current settings next to the
Agent management address, which it never changes.

```bash
miobridge nodes proxy ht --server ht.example.com --sni ht.example.com \
  --cert-verify strict --protocols trojan,hysteria2 --name HT
miobridge nodes proxy ht --json     # show the current settings
miobridge update --json             # regenerate the subscription artifacts
```

## Operations

```bash
curl -fsS http://localhost:3000/health
miobridge status --json
```

For troubleshooting, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

## License

MIT
