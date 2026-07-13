---
name: coding-conventions
description: Current coding conventions
metadata:
  type: project
---

# Coding Conventions

- Prefer existing service and UI patterns.
- Keep API routes thin. Put framework-independent business logic in
  `packages/core`; keep Next composition, logging, SSH/deployment, and dashboard
  lifecycle adapters in `packages/frontend/src/server/**`.
- Keep Markdown short. Move only durable, current facts into memory files.
- Run `bun run lint`, both workspace typechecks, and relevant core/packages/frontend/Agent
  tests before handoff when code changes warrant it.
