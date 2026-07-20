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
- A configured local node also runs Agent with `sing-box`, `xray`, and `v2ray`
  discovery by default; legacy sing-box-only local profiles are filled forward.
  Direct local sing-box collection remains a compatibility source; exact URLs
  are deduplicated.
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

## 2026-07-16 — Dashboard capability ownership

- Browser write actions have one owning page: node records, deployment tasks,
  Agent lifecycle, runtime monitoring, subscription generation, derived outputs,
  and subscription health are separate capabilities connected by link-only SOP
  navigation.
- Software install, reinstall, upgrade, repair, and uninstall use persisted
  node-by-component deployment tasks; day-to-day start/stop/restart remains on
  the Agent or runtime maintenance page.

## 2026-07-16 — Dashboard browser-test boundary

- `packages/e2e` is the private Playwright workspace. It serves the built SPA
  through the real CLI HTTP routes on loopback while replacing SSH, Agent,
  systemd, and remote-kernel operations with deterministic stateful ports.
- Every run owns its runtime and report directories; browser and server network
  guards prevent the suite from contacting configured or Tailscale nodes.
