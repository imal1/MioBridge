---
name: bug-fixes
description: Compact bug fixes and operational lessons for MioBridge
metadata:
  type: project
---

# Bug Fixes

- 2026-07-20: Per-config 233boy Agent collection passes config basenames to
  `url [name]`, preserving public endpoints for the loopback-managed local node;
  artifact publication also rejects loopback and unspecified proxy addresses.
- 2026-07-20: Local privilege fallback decides whether it is already root from
  the Dashboard process UID, not the profile username. The local profile exposes
  and accepts only the actual Dashboard runtime user so its password matches sudo.
- 2026-07-20: Local protocol-kernel privilege fallback accepts the local profile's
  username/password. Non-root credentials may be persisted; root credentials are
  held only for the next deployment task and cleared when it finishes.
- 2026-07-20: 233boy kernels keep one system installation layout: direct script
  execution retries with elevation only after an explicit permission/root error.
  The Dashboard unit omits `PrivateTmp` so host root ownership is not remapped to
  overflow UID 65534 when the controlled elevation path is required.
- 2026-07-20: Agent release installer writes unquoted systemd directive values;
  quoted `WorkingDirectory=` values are interpreted literally and prevent service
  activation, so the installer correctly rolls back instead of leaving an Agent down.
- 2026-07-20: Subscription aggregation expands every managed node, kernel,
  config file, and configured client (including structured Hysteria2/TUIC/
  Shadowsocks fallbacks and `hy2://`), and repairs empty legacy local-Agent
  kernel lists before export. Clash conversion rejects partial node loss, allows
  enough time for first-run validation, and emits the full DNS/group template
  without replacing the existing routing rules.
- 2026-07-19: Protocol-kernel install and maintenance are direct-only: upstream
  233boy installers and global wrappers run without MioBridge-generated sudo or
  privilege retries. Upgrade also rewrites the managed Dashboard user unit so
  legacy `NoNewPrivileges` template state cannot survive a binary upgrade.
- 2026-07-19: Agent deployment no longer installs selected missing protocol
  kernels. Agent and mihomo use user paths and user systemd without sudo; 233boy
  wrappers run directly and elevate only after an explicit permission failure.
- 2026-07-19: Local-node installation now bootstraps a verified Agent, reconciles
  its observed state, and keeps it in deployment/Agent/runtime/subscription flows.
  Multi-kernel collection uses each 233boy `url` command with per-config isolation;
  Clash conversion preserves transport/Reality fields and uses safe LAN/CN rules.
- 2026-07-16: Anchor the runtime `logs/` ignore rule and restore the Core log
  service it had hidden, including stable tail/filter and abortable follow.
- 2026-07-15: Protocol-kernel deployment delegates installation and lifecycle
  actions to the 233boy sing-box/Xray/V2Ray scripts. Detection requires their
  `/usr/local/bin/<kernel>` wrapper and `url [name]` command, so bare official
  cores are no longer mistaken for node-source providers. Reinstall preserves
  both aggregate and profile configs and restores them if installation fails.
- 2026-07-16: Dashboard daemon start waits for `/health`, resets a failed user
  unit before restart, and CLI uninstall removes/reloads the managed unit.
- 2026-07-16: Dashboard shutdown destroys open SSE responses and sockets so
  upgrade, stop, and restart cannot hang on long-lived streams.
- 2026-07-16: Dashboard `/health` reports the Core build version rather than
  an upgrade override environment variable.
- 2026-07-16: Saving monitored kernels now validates paths/config, atomically
  replaces the remote Agent config, verifies restart health, and rolls back on
  failure before updating control-plane state; empty kernels use a valid array.
- 2026-07-14: Managed dependencies and self-upgrade archives use `node:zlib`;
  release CLIs no longer depend on the unavailable `DecompressionStream` global.
- 2026-07-14: CLI artifact downloads retry transient network and timeout failures
  with bounded per-attempt timeouts before setup or upgrade fails.
- 2026-07-14: `uninstall --purge` removes the CLI and complete runtime directory;
  plain `uninstall` remains the safe configuration-preserving default.
- 2026-07-14: The one-line installer resolves and verifies a release without
  relying on its source path, then atomically installs both the CLI and dashboard;
  piped execution never looks for `/home/<user>/manage.sh`.
- 2026-07-14: Dashboard HTTP routes, SSH kernel detection, Agent deployment, and
  lifecycle actions run inside the compiled CLI instead of a browser framework
  runtime or shell management tree.
- 2026-07-14: Node kernel updates use a real `PUT /api/cluster/nodes` handler,
  cluster updates use POST consistently, and Agent action routes call their
  matching operation rather than silently succeeding.
- 2026-07-14: Core reads and writes YAML directly, so production no longer needs
  an external YAML command-line tool.
- 2026-07-14: The dashboard health indicator renders safely outside its optional
  provider context, and navigation uses stable browser URLs.
- 2026-07-12: Runtime paths and state are independent of cwd and remain under
  `~/.config/miobridge`; configured binaries are resolved independently.
