# Contributing

## Setup

Requirements: Bun 1+, Node.js 18+, `mihomo`, `yq` v4, and optionally
`sing-box`.

```bash
bun install
bun run dev
```

Open `http://localhost:3001`.

## Checks

```bash
bun run lint
bun run core:typecheck
bun run core:test
bun run typecheck
bun run cli:typecheck
bun run cli:test
cd frontend && bun run test
cd ..
cd agent && bun test
cd ..
bun run build
```

Run the checks relevant to your change before opening a PR.

## Workflow

- Branch from `main`.
- Use Conventional Commits, for example `feat: add node status filter`.
- Open PRs against `main`; CI runs lint, core/frontend/CLI typechecks and
  contracts, Agent tests, x64/arm64 release archive checks, a standalone build,
  provider artifact packaging, a client-bundle boundary scan, and live
  compatibility-URL smoke tests. A disposable Linux systemd job verifies user
  linger/reconnect and daemon lifecycle from the compiled CLI.
- Keep docs and memory files short. Prefer current facts over migration history.

## Project Rules

Read `AGENTS.md` for architecture rules, commands, deployment notes, and memory
maintenance.
