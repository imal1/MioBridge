# AGENTS.md

Keep this file small. It is loaded often.

## Project

MioBridge is a TypeScript subscription converter. The primary self-hosted runtime
is the compiled Linux CLI under `packages/cli/`; `packages/frontend/` is the Vite
dashboard, and `packages/core/` owns framework-independent behavior.

## Architecture Rules

- Framework-independent backend logic lives in `packages/core`; expose it through
  explicit `@miobridge/core` exports and the `MioBridgeCore` facade.
- `packages/cli` is the Linux composition root and owns setup, subscription,
  status, dashboard lifecycle, upgrade, and uninstall commands.
- Server operations after bootstrap must be exposed through the `miobridge`
  binary, not new management shell scripts.
- Runtime config/data/logs/backups live under `~/.config/miobridge`, independent
  of cwd. Config is `~/.config/miobridge/config.yaml`.
- External binaries are `mihomo` and optionally `sing-box`; prefer
  `~/.config/miobridge/bin/`, then repo `bin/`, then PATH.
- Public compatibility URLs are `/subscription.txt`, `/clash.yaml`, `/raw.txt`,
  and `/health`.
- Main node generates `raw.txt`, `subscription.txt`, and `clash.yaml`. Child nodes
  only run the Agent/kernel and expose source URLs.
- Normal remote Agent checks use public `http://<host>:<agentPort>` plus HMAC.
  SSH is for deployment/diagnosis only.

## Commands

```bash
bun install
bun run dev                 # packages/frontend Vite dev server
bun run build               # Vite dashboard build
bun run lint                # oxlint packages/frontend/src
bun run typecheck           # frontend TypeScript check
bun run core:typecheck      # core package TypeScript check
bun run core:test           # compiled Bun/Node headless and unit tests
bun run cli:typecheck
bun run cli:test
bun run --cwd packages/frontend test
bun run --cwd agent typecheck
bun run --cwd agent test
bun build agent/src/server.ts --compile --target=bun-linux-x64 --outfile agent/miobridge-agent
```

Do not run root `npx tsc --noEmit`; use the frontend, CLI, and core workspace commands.

## Deployment Notes

- `scripts/install.sh` is the sole server bootstrap shell and installs a verified
  release CLI to `~/.local/bin/miobridge` plus its static dashboard provider.
- After bootstrap, lifecycle operations use `miobridge` commands only.
- Release archives and checksums are produced by `scripts/package-cli-release.sh`.

## UI

Use the existing Botanical Garden design tokens from
`packages/frontend/src/styles/globals.css`. Avoid hard-coded colors and Tailwind gray
palette classes in components; prefer CSS variables and existing UI patterns.

## Memory

Update `.Codex/memory/` only when the change matches its topic:

- bug fix: prepend to `.Codex/memory/bug-fixes.md`
- architecture/tech decision: append to `.Codex/memory/project-architecture.md`
- CI/CD change: update `.Codex/memory/ci-cd-pipeline.md`
- deployment flow change: update `.Codex/memory/deployment-flow.md`
- config convention change: update `.Codex/memory/config-patterns.md`
- coding/lint convention change: update `.Codex/memory/coding-conventions.md`

Keep memory entries short. Add new files to `.Codex/memory/MEMORY.md`.
