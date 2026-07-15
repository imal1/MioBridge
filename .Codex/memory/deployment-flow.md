---
name: deployment-flow
description: Current deployment flow notes
metadata:
  type: project
---

# Deployment Flow

- Production Dashboard is served by the installed CLI together with its
  same-origin control-plane API; a static frontend host is not authoritative.
- GitHub Actions is a CI gate only; it does not deploy and does not install or
  run Vercel CLI.
- Self-hosted Linux starts with the checksum-verifying `scripts/install.sh` and
  installs the CLI plus dashboard provider; thereafter it uses only `miobridge`
  lifecycle commands, with no source checkout or management script tree.
- The CLI is the management layer; `mihomo` and the optional `sing-box` runtime
  remain separately discovered or checksum-verified managed binaries.
- Child Agent deployment selects a checksum-covered x64/arm64 binary from the
  matching MioBridge Release; child servers do not install Bun or compile source.
- Child nodes may bootstrap or repair only the Agent with the release
  `install-agent.sh`; it validates `agent.yaml`, installs an explicit `--config`
  systemd unit, health-checks locally, and rolls binary/config/unit back together.
- Child deployment detects every supported kernel, lets operators choose the
  monitored set, installs selected missing kernels, then deploys one Agent config.
- New nodes persist as empty-kernel drafts; a successful deployment commits the
  selected kernels. Deployment IDs prevent stale jobs from overwriting newer
  node state or progress.
- Remote Agent config and systemd unit replacement use checked same-directory
  temporary files and atomic moves; sudo passwords travel through SSH stdin.
- SSH detection, deployment, Agent lifecycle, and kernel actions are CLI runtime
  adapters behind the dashboard API; they do not invoke a local management script.
- Dashboard daemon start waits for `/health`; stop, uninstall, and process
  shutdown clean up the user unit and open SSE connections before exit.
