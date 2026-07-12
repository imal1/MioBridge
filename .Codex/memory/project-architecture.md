---
name: project-architecture
description: Current MioBridge architecture decisions
metadata:
  type: project
---

# Project Architecture

- The active service is one Next.js Pages Router app under `frontend/`, using
  Node runtime and standalone output.
- Backend services are framework-independent singletons in
  `frontend/src/server/**`.
- SSR uses direct service calls from `getServerSideProps`.
- mihomo is the local conversion engine; yq v4 handles YAML/config operations.
- Main node owns generated subscription artifacts; child nodes only expose Agent
  source URLs.
- Cluster state (nodes.yaml, deploy progress) goes through the `StateStore`
  abstraction (`stateStore.ts`): file backend under `~/.config/miobridge` when
  self-hosted, Upstash/Vercel-KV Redis REST backend when
  `UPSTASH_REDIS_REST_URL/TOKEN` or `KV_REST_API_URL/TOKEN` are set (required
  on Vercel, where function instances share no filesystem).
- A child Agent can monitor multiple kernels and returns structured, kernel-tagged
  sources plus per-kernel runtime status to the main node.
- Cluster proxy totals and generated artifacts use exact-URL global deduplication;
  Clash-only naming prefixes region and appends the source URL on name conflicts.
- `@miobridge/core` composes artifact generation and status through the explicit
  `MioBridgeCore` facade; runtime paths, state, kernels, metadata, clock, and
  source collectors are injected without frontend imports or module singletons.
## 2026-07-12 — Frontend core composition

- `frontend/src/server/core.ts` is the Node-only composition adapter for `@miobridge/core`; API routes and SSR consume its `MioBridgeCore`/node aggregation instances, while deployment and SSH lifecycle behavior remains frontend-owned.
