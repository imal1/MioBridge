# AGENTS.md

Keep this file small. It is loaded often.

## Project

MioBridge is a TypeScript subscription converter. The active app is a single
Next.js full-stack service under `frontend/` using Pages Router, Node runtime,
SSR, and `output: 'standalone'`. There is no separate Express server.

## Architecture Rules

- Framework-independent backend logic lives in `packages/core`; expose it through
  explicit `@miobridge/core` exports and the `MioBridgeCore` facade.
- `frontend/src/server/**` owns the Node composition root plus Next, logging,
  SSH/deployment, and dashboard lifecycle adapters. Keep API routes thin.
- SSR pages call services directly in `getServerSideProps`; do not self-call HTTP
  inside the same process.
- Node-only modules belong in `server/`, `pages/api/`, or
  `instrumentation-node.ts`. Keep `instrumentation.ts` guarded by
  `NEXT_RUNTIME === 'nodejs'` before dynamic import.
- Runtime config/data/logs/backups live under `~/.config/miobridge`, independent
  of cwd. Config is `~/.config/miobridge/config.yaml`.
- External binaries are `mihomo`, `yq`, and optionally `sing-box`; prefer
  `~/.config/miobridge/bin/`, then repo `bin/`, then PATH.
- Public compatibility URLs `/subscription.txt`, `/clash.yaml`, `/raw.txt`, and
  `/health` are Next rewrites to internal API routes.
- Main node generates `raw.txt`, `subscription.txt`, and `clash.yaml`. Child nodes
  only run the Agent/kernel and expose source URLs.
- Normal remote Agent checks use public `http://<host>:<agentPort>` plus HMAC.
  SSH is for deployment/diagnosis only.

## Commands

```bash
bun install
bun run dev                 # cd frontend && next dev -p 3001
bun run build               # Next standalone build
bun run start               # node frontend/.next/standalone/frontend/server.js
bun run lint                # oxlint frontend/src
bun run typecheck           # frontend TypeScript check
bun run core:typecheck      # core package TypeScript check
bun run core:test           # compiled Bun/Node headless and unit tests
cd frontend && bun run test
cd agent && bun test
cd agent && bun build src/server.ts --compile --target=bun-linux-x64 --outfile miobridge-agent
```

Do not run root `npx tsc --noEmit`; use the frontend and core workspace commands.

## Deployment Notes

- Production runs Node with `PORT`, `HOSTNAME=0.0.0.0`, and
  `NODE_ENV=production`.
- `scripts/manage.sh install` builds and installs standalone output to
  `~/.config/miobridge/dist/frontend/server.js`.
- Standalone output needs `.next/static` and `public` copied into the runtime
  directory; preserve that in build/deploy changes.

## UI

Use the existing Botanical Garden design tokens from
`frontend/src/styles/globals.css`. Avoid hard-coded colors and Tailwind gray
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

<!-- BEGIN FLOW-NEXT -->
## Flow-Next

This project uses Flow-Next for task tracking. Use `.flow/bin/flowctl` instead of markdown TODOs or TodoWrite.

**Quick commands:**
```bash
.flow/bin/flowctl list                # List all specs + tasks
.flow/bin/flowctl specs               # List all specs
.flow/bin/flowctl tasks --spec fn-N   # List tasks for spec
.flow/bin/flowctl ready --spec fn-N   # What's ready
.flow/bin/flowctl show fn-N.M         # View task
.flow/bin/flowctl start fn-N.M        # Claim task
.flow/bin/flowctl done fn-N.M --summary-file s.md --evidence-json e.json
```

**Creating a spec** ("create a spec", "spec out X", "write a spec for X"):

Create one directly — do NOT use `/flow-next:plan` (that breaks specs into tasks). The canonical 7-section spec scaffold lives at `.flow/templates/spec.md` (copied here by `/flow-next:setup`) — read it for the section list, scope ownership, and `## Decision Context` H3 conditional. To customize the scaffold for this project, copy `.flow/templates/spec.md` to `<repo-root>/SPEC.md` and edit there — the discovery cascade prefers it (first match wins): `<repo_root>/SPEC.md` → `<repo_root>/spec.md` → `.flow/templates/spec.md` → bundled plugin template.

```bash
.flow/bin/flowctl spec create --title "Short title" --json
.flow/bin/flowctl spec set-plan <spec-id> --file - --json <<'EOF'
# Title

# ... fill the 7 canonical sections (see SPEC.md / .flow/templates/spec.md)
EOF
```

After creating a spec, choose next step:
- `/flow-next:plan <spec-id>` — research + break into tasks
- `/flow-next:interview <spec-id>` — deep Q&A to refine the spec

**Rules:**
- Use `.flow/bin/flowctl` for ALL task tracking
- Do NOT create markdown TODOs or use TodoWrite
- Re-anchor (re-read spec + status) before every task

**Optional — codebase feature map:** `/flow-next:map` wraps [openclaw/clawpatch](https://github.com/openclaw/clawpatch)'s `clawpatch map` command to build a semantic feature index under `.clawpatch/features/*.json`. When present, `repo-scout` and `context-scout` use it to anchor R-IDs and `Investigation targets` to concrete codebase regions. Provider-free by default; install via `pnpm add -g clawpatch` (Node 22+).

**More info:** `.flow/bin/flowctl --help` or read `.flow/usage.md`
<!-- END FLOW-NEXT -->

Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:
- Drop: articles (a/an/the), filler (just/really/basically), pleasantries, hedging
- Fragments OK. Short synonyms. Technical terms exact. Code unchanged.
- Pattern: [thing] [action] [reason]. [next step].
- Not: "Sure! I'd be happy to help you with that."
- Yes: "Bug in auth middleware. Fix:"

Switch level: /caveman lite|full|ultra|wenyan
Stop: "stop caveman" or "normal mode"

Auto-Clarity: drop caveman for security warnings, irreversible actions, user confused. Resume after.

Boundaries: code/commits/PRs written normal.
