---
name: bug-fixes
description: Compact bug fixes and operational lessons for MioBridge
metadata:
  type: project
---

# Bug Fixes

- 2026-07-14: The frontend declares Vite directly so Vercel installs the
  `vite` executable before running the production build.
- 2026-07-12: Core composition preserves configured mihomo/backup paths, resolves
  application and sing-box binaries independently of cwd, and rejects Agent
  sources tied to unmonitored or inaccessible kernels.
- 2026-07-12: Agent config and systemd unit deployment now uses checked,
  same-directory temporary files plus atomic rename; sudo passwords travel over
  SSH stdin, node YAML strings use JSON-compatible quoting, and proxy logs omit
  credentials and complete URLs.
- 2026-07-12: FileStateStore normalizes its configured base directory before
  path-containment checks, so trailing separators no longer reject valid keys.
- 2026-07-12: Offline node status and kernel UI now preserve a fixed
  sing-box/Xray/V2Ray shape. Missing runtime entries render as unknown while
  desired kernel configuration remains authoritative for monitoring totals.
- 2026-07-12: NodeManager now initializes MioBridge/config before importing the
  shared logger. This avoids Bun leaving `config` in a TDZ while preserving the
  configured logging level and directory.
- 2026-07-11: Child-node SSH authentication is now explicit password-or-key.
  Private keys are selected as files, validated as unencrypted SSH keys, stored
  separately in StateStore, and never returned by the node API or written into
  nodes.yaml. SSH deployment no longer falls back across credential methods.
- 2026-07-11: Node registry and deploy progress no longer vanish between Vercel
  function instances. nodes.yaml IO and deployProgressStore now go through the
  `StateStore` abstraction — file backend by default, Redis (Upstash/Vercel KV
  REST, plain fetch) when the REST env vars are configured. Without Redis env
  vars on Vercel the old ephemeral behavior remains, with a startup warning.
- 2026-07-11: Agent deploy no longer requires the ~100MB compiled binary in the
  control plane bundle. When `agent/miobridge-agent` is missing locally (Vercel),
  the target host downloads the repo tarball pinned to the control plane's
  commit and compiles the agent with its own Bun (`buildAgentOnRemote` in
  deployManager). Self-hosted control planes with the binary still SFTP-upload.
- 2026-07-04: Vercel control plane is no longer counted as a cluster node;
  mihomo is a required binary for Clash generation and validation, with no
  built-in conversion fallback.
- 2026-07-04: Logs are fetched from the selected child Agent instead of local
  Vercel filesystem logs.
- 2026-07-04: mihomo validation runs with `-d /tmp/...` on Vercel so it does
  not write under the read-only function bundle.
- 2026-07-02: SSR pages catch service import failures, browser-only ConvertModal
  loads client-side, and `/api/logs` returns structured fallback data instead
  of surfacing filesystem errors as page/API 500s.
- 2026-07-02: Homepage Dashboard loads client-side to avoid Pages Router SSR
  tracing Recharts/Redux Toolkit ESM incompletely in standalone/Vercel builds.
- 2026-07-01: Deploy progress polling now preserves active/failed state, terminal
  timestamps, and clears dashboard pollers reliably.
- 2026-07-01: Main node owns generated subscription artifacts and aggregates
  remote Agent `/api/urls`; child nodes only expose source URLs.
- 2026-07-01: Agent source discovery covers 233boy sing-box/xray/v2ray layouts
  under `/etc` and `/usr/local/etc`.
- 2026-07-01: Normal Agent status/health/URL checks use public HMAC endpoints
  only; SSH fallback is reserved for deployment and diagnostics.
- 2026-07-01: Node/Agent port fields are parsed and persisted so public Agent
  checks use the configured port.
- 2026-07-01: Agent deployment always restarts the service and reuses the node
  secret from `nodes.yaml`.
- 2026-07-01: SSH deploy records first-use host keys. The former pasted-key and
  local-path credential flow was replaced by uploaded StateStore key records.
- 2026-07-01: Non-root Agent deployment runs privileged remote steps through
  sudo and stages binaries through `/tmp`.
