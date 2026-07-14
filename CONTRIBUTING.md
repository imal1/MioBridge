# Contributing

## Setup

Requirements: Bun 1+, `mihomo`, and optionally `sing-box` for live runtime
testing.

```bash
bun install
bun run dev
```

Open `http://localhost:5173`. Run `miobridge dashboard foreground` separately
when the SPA needs live API data.

## Checks

```bash
bun run lint
bun run core:typecheck
bun run core:test
bun run typecheck
bun run cli:typecheck
bun run cli:test
bun run --cwd packages/frontend test
bun run --cwd agent test
bun run build
```

Run the checks relevant to your change before opening a PR.

## Workflow

- Branch from `main`.
- Use Conventional Commits, for example `feat: add node status filter`.
- Open PRs against `main`; CI runs lint, core/frontend/CLI typechecks and
  contracts, Agent tests, x64/arm64 release archive checks, a Vite build,
  static-provider packaging, and a client-bundle boundary scan. A disposable
  Linux systemd job verifies compatibility URLs, user
  linger/reconnect and daemon lifecycle from the compiled CLI.
- Keep docs and memory files short. Prefer current facts over outdated history.

## Project Rules

Read `AGENTS.md` for architecture rules, commands, deployment notes, and memory
maintenance.
