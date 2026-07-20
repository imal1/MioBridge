# Linux CLI and dashboard operations

`miobridge` is a self-contained Linux x64/arm64 command. It uses
`@miobridge/core` headlessly; no dashboard provider is needed for `update` or
`status`.

This is separate from the Vercel-hosted production dashboard. Vercel deployment
is documented in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Install and upgrade

The only server-side shell entrypoint is the bootstrap installer:

```bash
curl -fsSL https://raw.githubusercontent.com/imal1/MioBridge/main/scripts/install.sh | bash
miobridge --version
```

The installer selects `linux-x64` for `x86_64`/`amd64` and `linux-arm64` for
`aarch64`/`arm64`, downloads the versioned archive and `SHA256SUMS` from its
GitHub Release, verifies SHA-256, then atomically installs
`~/.local/bin/miobridge` and the static dashboard under
`~/.config/miobridge/dist/dashboard`, then runs
`miobridge setup --yes --local-node` to install pinned runtime dependencies,
persist this server as the local node, and install the matching Agent configured
to monitor sing-box, Xray, and V2Ray from its checksum-covered release installer.
Pass `--no-local-node` to skip the local node and Agent. It needs `curl` or
`wget`, `tar`, and `sha256sum` (or `shasum`).
It does not require Git, Node.js, Bun, or a source checkout.

For a mirror, air-gapped staging server, or non-default binary directory:

```bash
sh install.sh --version 1.0.0 \
  --base-url https://mirror.example/miobridge/v1.0.0 \
  --install-dir "$HOME/.local/bin"
```

Failed download, checksum, extraction, or final replacement restores the
previous CLI and dashboard. After bootstrap, upgrade both through the binary:

```bash
miobridge upgrade
```

## Headless commands and retained data

```bash
miobridge status --json
miobridge update
miobridge setup                              # interactively choose the local node
miobridge setup --yes --local-node           # non-interactive local-node profile
miobridge nodes configure --no-local-node    # remove the local-node profile
```

Fresh installs configure the current server as the local node by default. Pass
`install.sh --no-local-node` to opt out, or change the role later:

```bash
miobridge nodes configure
miobridge nodes configure --local-node
miobridge nodes configure --no-local-node
```

The local node is stored in `~/.config/miobridge/nodes.yaml` as an ordinary
node profile named 本机节点 (host `127.0.0.1`). It shows up in the dashboard
node list like any other node and uses the same Agent deployment workflow;
being created by default at install time is its only difference.

Runtime config, generated outputs, backups, logs, and managed tools belong
under `~/.config/miobridge` (or `MIOBRIDGE_CONFIG_DIR`). `status --json` emits
only one JSON object. `update` and `status` work with no provider directory.

Remove only the CLI binary with:

```bash
miobridge uninstall
```

This preserves `~/.config/miobridge`, including `config.yaml`, data, generated
subscriptions, logs, and backups.

To remove the CLI and the complete MioBridge runtime directory, including
configuration, generated data, dashboard assets, and managed dependencies:

```bash
miobridge uninstall --purge
```

## Managed dependencies

`miobridge setup` reports each required tool as `configured`, `managed`,
`PATH`, or `missing`. It asks before each managed download; refusing makes no
filesystem change.

| Tool | Required | Purpose | Managed location/source |
| --- | --- | --- | --- |
| mihomo | Yes | Generate Clash output | `~/.config/miobridge/bin`; pinned MetaCubeX GitHub Release |
| sing-box | No | Optional local source extraction | Existing configured path or `PATH` |

Exact versions, URLs, and SHA-256 values are reviewed source in
[`packages/cli/src/setup/catalog.ts`](../packages/cli/src/setup/catalog.ts).
Setup redacts credentials and query secrets from errors.

Remote Agent deployment follows the same layering: the CLI selects the
same-version x64/arm64 compressed Agent asset, verifies `SHA256SUMS`, and installs
the binary on the child without installing Bun or compiling source.

For a manual child-node bootstrap, download `install-agent.sh` from the same
GitHub Release and an `agent.yaml` from the Dashboard deployment center:

```bash
scp agent.yaml root@child:/tmp/miobridge-agent.yaml
curl -fsSL https://github.com/imal1/miobridge/releases/latest/download/install-agent.sh \
  -o /tmp/install-agent.sh
sudo sh /tmp/install-agent.sh --config /tmp/miobridge-agent.yaml
```

This installer owns only `/usr/local/bin/miobridge-agent`,
`/etc/miobridge-agent/agent.yaml`, and the systemd service. It validates the
binary and config before replacement and rolls all three files back when restart
or local health verification fails. It never installs CLI, Dashboard, Bun,
mihomo, or protocol kernels. See [DEPLOYMENT.md](./DEPLOYMENT.md) for independent
parameter and mirror examples.

## Dashboard provider and systemd user service

Release archives already include the dashboard installed by `install.sh` and
updated by `miobridge upgrade`.

Provider layout is versioned by `provider.json`. The static provider declares
its artifact root and SPA fallback, and reserves `/api` plus the compatibility
paths `/health`, `/subscription.txt`, `/clash.yaml`, and `/raw.txt`. Replacing the
static artifact does not change CLI commands or runtime data ownership.

For persistent Linux service mode:

```bash
miobridge dashboard start
miobridge dashboard status --json
miobridge dashboard stop
```

`start` writes `~/.config/systemd/user/miobridge-dashboard.service` and starts
it with `systemctl --user`, then waits for `/health` before reporting success;
a failed unit is reset before retry. It asks before enabling systemd linger. Linger is
required to survive logout; non-interactive sessions receive this manual command:

```bash
sudo loginctl enable-linger "$USER"
```

No root system unit or PID-file fallback exists. The CLI refuses a conflicting
dashboard port. `miobridge uninstall` disables and removes the managed user unit,
then reloads systemd so no service points at a removed CLI. Inspect failures with:

```bash
journalctl --user -u miobridge-dashboard.service -f
```

## Troubleshooting

- `checksum verification failed`: do not retry with a modified archive. Obtain
  the exact archive and `SHA256SUMS` from the same trusted release or mirror.
- `Dashboard provider is not installed`: run `miobridge upgrade`, reinstall the
  matching release; headless `status` and `update` remain available.
- `systemd user manager is unavailable`: use foreground mode or Linux with a
  running user systemd manager. Containers and non-systemd systems are outside
  daemon-mode support.
- Dashboard exits after logout: enable linger, then run
  `miobridge dashboard start` again and inspect the user journal.
- Port occupied or provider crashes: stop conflict, then use the journal command
  printed by `dashboard status`.
