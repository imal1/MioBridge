---
name: coding-conventions
description: Current coding conventions
metadata:
  type: project
---

# Coding Conventions

- Prefer existing service and UI patterns.
- Keep API routes thin. Put framework-independent business logic in
  `packages/core`; keep Linux composition, SSH/deployment, HTTP, and dashboard
  lifecycle adapters in `packages/cli`.
- Keep Markdown short. Move only durable, current facts into memory files.
- Run `bun run lint`, workspace typechecks, and relevant core/CLI/frontend/Agent
  tests before handoff when code changes warrant it.
- Do not run Dashboard E2E automatically; run it only when the user explicitly asks.
