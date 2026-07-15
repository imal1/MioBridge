---
name: deployment-flow
description: Current deployment flow notes
metadata:
  type: project
---

# Deployment Flow

- Production dashboard is served by the installed CLI process together with its
  same-origin control-plane API; the former Vercel static deployment is not the
  authoritative runtime.
- GitHub Actions is a CI gate only; it does not deploy and does not install or
  run Vercel CLI.
- Self-hosted Linux starts with the checksum-verifying `scripts/install.sh` and
  installs the CLI plus dashboard provider; thereafter it uses only `miobridge`
  lifecycle commands, with no source checkout or management script tree.
- Installation configures the server as a local node by default; operators can
  opt out with `--no-local-node` and later change the role through
  `miobridge nodes configure` without changing child nodes.
- The CLI is the management layer; `mihomo` and the optional `sing-box` runtime
  remain separately discovered or checksum-verified managed binaries.
- Child Agent deployment selects a checksum-covered x64/arm64 binary from the
  matching MioBridge Release; child servers do not install Bun or compile source.
- Child deployment detects every supported kernel, lets operators choose the
  monitored set, installs selected missing kernels, then deploys one Agent config.
- New nodes persist as empty-kernel drafts; a successful deployment commits the
  selected kernels. Deployment IDs prevent stale jobs from overwriting newer
  node state or progress.
- The deployment API separates `listener`, `kernels`, and `all` scopes for child
  nodes. Kernel-only deployment refreshes/restarts the existing listener because
  its monitored-kernel config is a dependency, but does not reinstall its binary.
- The local listener is embedded in the dashboard process. The local one-click
  action installs every configured missing kernel from pinned, checksum-verified
  upstream artifacts into the managed bin directory, then verifies actual
  listener/kernel readiness. It never treats a config save as deployment.
- Terminal deployment state is runtime-derived: the listener must first be
  deployed/listening; after that, no configured kernels yields `no_kernels`,
  otherwise every configured kernel must be detected, monitored, and accessible
  for 100%.
- Deployment stage changes are pushed over same-origin SSE at
  `/api/cluster/deploy/events`; the frontend keeps a low-frequency polling
  fallback. The stream disables proxy buffering and active sockets are closed on
  dashboard shutdown so upgrade/restart cannot hang.
- The deployment workbench closes the operator SOP in one place: structured
  prerequisite/listener/kernel plans drive single-node or batch deployment,
  inline kernel configuration and SSH credential repair persist before deployment,
  duplicate active jobs are rejected, and subscription generation is enabled only
  after all nodes pass runtime verification.
- Remote Agent config and systemd unit replacement use checked same-directory
  temporary files and atomic moves; sudo passwords travel through SSH stdin.
- SSH detection, deployment, Agent lifecycle, and kernel actions are CLI runtime
  adapters behind the dashboard API; they do not invoke a local management script.
