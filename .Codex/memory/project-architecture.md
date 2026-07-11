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
