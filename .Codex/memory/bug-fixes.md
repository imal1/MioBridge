---
name: bug-fixes
description: Compact bug fixes and operational lessons for MioBridge
metadata:
  type: project
---

# Bug Fixes

- 2026-07-04: Vercel control plane is no longer counted as a cluster node;
  mihomo/yq absence falls back to built-in Clash YAML generation and optional
  mihomo validation.
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
- 2026-07-01: SSH deploy records first-use host keys and accepts pasted private
  keys or local key paths.
- 2026-07-01: Non-root Agent deployment runs privileged remote steps through
  sudo and stages binaries through `/tmp`.
