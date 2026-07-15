---
name: project-architecture
description: Current MioBridge architecture decisions
metadata:
  type: project
---

# Project Architecture

- The compiled Linux CLI under `packages/cli` is the self-hosted composition
  root. It owns commands, the dashboard API/static server, and lifecycle.
- `packages/frontend` is a browser-only Vite SPA served as a static provider.
- Framework-independent backend services live in `@miobridge/core` and are
  exposed through explicit exports and the `MioBridgeCore` facade.
- mihomo is the local conversion engine; Core reads and writes YAML directly.
- Main node owns generated subscription artifacts; child nodes only expose Agent
  source URLs.
- Cluster state goes through `StateStore` under `~/.config/miobridge`.
- A child Agent can monitor multiple kernels and returns structured, kernel-tagged
  sources plus per-kernel runtime status to the main node.
- Cluster proxy totals and generated artifacts use exact-URL global deduplication;
  Clash-only naming prefixes region and appends the source URL on name conflicts.
- `@miobridge/core` composes artifact generation and status through the explicit
  `MioBridgeCore` facade; runtime paths, state, kernels, metadata, clock, and
  source collectors are injected without frontend imports or module singletons.
## 2026-07-12 — CLI dashboard provider boundary

- `packages/cli` consumes public `@miobridge/core` exports headlessly. Its
  static dashboard manifest and user-systemd launcher own dashboard lifecycle;
  provider removal preserves core config and data.

## 2026-07-14 — CLI-first server lifecycle

- `scripts/install.sh` is the only server bootstrap shell. It installs a verified
  release binary and invokes non-interactive CLI setup; setup, update, dashboard
  lifecycle, upgrade, and uninstall are thereafter `miobridge` commands.
- Shell remains only for bootstrap, development packaging, and CI/E2E
  orchestration.

## 2026-07-14 — Static dashboard boundary

- The dashboard is a Vite SPA. Browser pages fetch the CLI API directly; all
  server routes and composition live in `packages/cli`.
- The former frontend server tree, framework runtime configuration, root server
  TypeScript configuration, and unused server dependencies were removed.
- Linux release archives contain both the compiled CLI and static dashboard.
  Install and self-upgrade replace both without requiring a server runtime.

## 2026-07-15 — Explicit local-node role

- `nodes.yaml` stores an explicit `kind: local|child`. The optional `local`
  record is monitored in-process and never sent through the Agent/SSH path;
  child nodes retain Agent-backed collection and deployment.
- Local sing-box sources participate in artifacts only when the local-node role
  is enabled. Cluster DTOs include the local node and separate local/child counts.
- Dashboard pages present one unified node collection. `kind: local|child`
  remains an internal routing distinction rather than a separate user-facing
  child-node category.
- Node runtime DTOs expose listener deployment/listening separately from kernel
  runtime. Deployment readiness requires the listener plus every configured
  kernel to be detected, monitored, and accessible.

## 2026-07-15 — Deployment plan contract

- The CLI dashboard exposes structured per-node deployment plans and server-side
  batch orchestration. Plans separate prerequisites, listener readiness, and
  configured-kernel readiness and recommend the smallest repair scope.
- Deployment execution is single-flight per node; frontend progress is an SSE
  projection of the server task and terminal success remains runtime-derived.
