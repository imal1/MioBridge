# Copilot Instructions

Use `AGENTS.md` as the source of truth for this repository. All project rules, architecture conventions, commands, and response style are defined there.

Important current facts:

- Active UI: Vite SPA under `packages/frontend/`.
- Runtime and HTTP server: compiled `miobridge` CLI under `packages/cli/`.
- Framework-independent logic: `packages/core/`.
- Commands: `bun run lint`, `bun run typecheck`, `bun run core:test`, `bun run cli:test`, `bun run build`.
- Config/data/logs: `~/.config/miobridge/`.

The CLI binary is the only production entry point.
