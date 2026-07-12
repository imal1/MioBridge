# Copilot Instructions

Use `AGENTS.md` as the source of truth for this repository. All project rules, architecture conventions, commands, and response style are defined there.

Important current facts:

- Active app: single Next.js full-stack service under `frontend/`.
- Backend code: `frontend/src/server/**` plus thin `frontend/src/pages/api/**`.
- Commands: `bun run lint`, `bun run typecheck`, `bun run build`.
- Config/data/logs: `~/.config/miobridge/`.

Do not rely on old Express/backend-plus-frontend migration notes.