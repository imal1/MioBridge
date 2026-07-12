# Linux CLI and dashboard operations

`miobridge` is a self-contained Linux x64/arm64 command. It uses
`@miobridge/core` headlessly; no Next.js process or dashboard provider is needed
for `update` or `status`.

This is separate from the Vercel-hosted production dashboard. Vercel deployment
is documented in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Install and upgrade

Choose an exact release version. Download the installer, inspect it if required
by local policy, then run it:

```bash
curl -fLO https://raw.githubusercontent.com/imal1/miobridge/main/scripts/install-cli.sh
sh install-cli.sh --version 0.1.0
~/.local/bin/miobridge --version
```

The installer selects `linux-x64` for `x86_64`/`amd64` and `linux-arm64` for
`aarch64`/`arm64`, downloads the versioned archive and `SHA256SUMS` from its
GitHub Release, verifies SHA-256, then atomically replaces only
`~/.local/bin/miobridge`. It needs `curl` or `wget`, `tar`, and `sha256sum` (or
`shasum`). It does not require Git, Node.js, or Bun.

For a mirror, air-gapped staging server, or non-default binary directory:

```bash
sh install-cli.sh --version 0.1.0 \
  --base-url https://mirror.example/miobridge/v0.1.0 \
  --install-dir "$HOME/.local/bin"
```

Failed download, checksum, extraction, or final metadata replacement leaves the
previous CLI binary in place. Re-run the same command with a newer explicit
version to upgrade.

## Headless commands and retained data

```bash
miobridge status --json
miobridge update
miobridge setup
```

Runtime config, generated outputs, backups, logs, and managed tools belong
under `~/.config/miobridge` (or `MIOBRIDGE_CONFIG_DIR`). `status --json` emits
only one JSON object. `update` and `status` work with no provider directory.

Remove only the CLI binary with:

```bash
sh install-cli.sh --uninstall
```

This preserves `~/.config/miobridge`, including `config.yaml`, data, generated
subscriptions, logs, and backups.

## Managed dependencies

`miobridge setup` reports each required tool as `configured`, `managed`,
`PATH`, or `missing`. It asks before each managed download; refusing makes no
filesystem change.

| Tool | Required | Purpose | Managed location/source |
| --- | --- | --- | --- |
| mihomo | Yes | Generate Clash output | `~/.config/miobridge/bin`; pinned MetaCubeX GitHub Release |
| Bun | Yes for provider/build tooling | Dashboard provider runtime and local builds | `~/.config/miobridge/bin`; pinned Bun GitHub Release |
| yq v4 | Yes | YAML/config operations | `~/.config/miobridge/bin`; pinned mikefarah/yq GitHub Release |
| sing-box | No | Optional local source extraction | Existing configured path or `PATH` |

Exact versions, URLs, and SHA-256 values are reviewed source in
[`packages/cli/src/setup/catalog.ts`](../packages/cli/src/setup/catalog.ts).
Setup redacts credentials and query secrets from errors.

## Dashboard provider and systemd user service

The release CLI intentionally does not bundle a dashboard. Package current Next
standalone output as a provider when self-hosting:

```bash
bun run build
bash scripts/package-dashboard-provider.sh "$HOME/.config/miobridge/dist/dashboard"
miobridge dashboard foreground
```

Provider layout is versioned by `provider.json`. It declares executable,
entrypoint, runtime environment, health URL, and four compatibility URLs:
`/health`, `/subscription.txt`, `/clash.yaml`, and `/raw.txt`. Future fn-4
providers can replace this artifact (for example, a Vite build) without changing
CLI commands or runtime data ownership.

For persistent Linux service mode:

```bash
miobridge dashboard start
miobridge dashboard status --json
miobridge dashboard stop
```

`start` writes `~/.config/systemd/user/miobridge-dashboard.service` and starts
it with `systemctl --user`. It asks before enabling systemd linger. Linger is
required to survive logout; non-interactive sessions receive this manual command:

```bash
sudo loginctl enable-linger "$USER"
```

No root system unit or PID-file fallback exists. If an old
`miobridge.service` exists, stop/disable it before starting the user service.
The CLI also refuses a conflicting dashboard port. Inspect failures with:

```bash
journalctl --user -u miobridge-dashboard.service -f
```

To remove the optional dashboard while retaining CLI/runtime data:

```bash
miobridge dashboard stop
rm -rf "$HOME/.config/miobridge/dist/dashboard"
miobridge status --json
```

## Troubleshooting

- `checksum verification failed`: do not retry with a modified archive. Obtain
  the exact archive and `SHA256SUMS` from the same trusted release or mirror.
- `Dashboard provider is not installed`: package/install a provider first;
  headless `status` and `update` remain available.
- `systemd user manager is unavailable`: use foreground mode or Linux with a
  running user systemd manager. Containers and non-systemd systems are outside
  daemon-mode support.
- Dashboard exits after logout: enable linger, then run
  `miobridge dashboard start` again and inspect the user journal.
- Port occupied or provider crashes: stop conflict, then use the journal command
  printed by `dashboard status`.
