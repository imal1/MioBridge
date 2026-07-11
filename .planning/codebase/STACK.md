# Technology Stack

**Analysis Date:** 2026-07-11

## Languages

**Primary:**
- TypeScript 6.0.x in the active full-stack application - Pages Router UI, SSR, API routes, and framework-independent services under `frontend/src/`; the version range is declared in `frontend/package.json`.
- TypeScript 5.x in the remote node agent - dependency-free Bun HTTP agent and kernel adapters under `agent/src/`; its compiler range is declared in `agent/package.json`.

**Secondary:**
- JavaScript (Node.js/CommonJS and ESM) - Next configuration in `frontend/next.config.js`, browser E2E harness in `scripts/e2e-browser.mjs`, and build-time mihomo acquisition in `scripts/ensure-mihomo-binary.mjs`.
- Bash - Linux installation, service management, standalone packaging, deployment, and distributed E2E flows under `scripts/`, with compatibility entry point `manage.sh`.
- CSS - global Botanical Garden design system and Tailwind layers in `frontend/src/styles/globals.css`.
- YAML - runtime configuration templates in `config.yaml.example` and `agent/agent.yaml.example`, GitHub Actions in `.github/workflows/ci.yml`, and generated node state (`nodes.yaml`).

## Runtime

**Environment:**
- Node.js >=18 for the active Next.js standalone server; CI builds with Node.js 20 and production starts `frontend/.next/standalone/frontend/server.js` as defined in `package.json` and `.github/workflows/ci.yml`.
- Bun >=1.0 for dependency installation, development, tests, build orchestration, and compiling `agent/src/server.ts` into Linux executables; the repository pins `bun@1.0.30` in `package.json` and `frontend/package.json`.
- Linux is the primary self-hosted production environment because service control uses systemd and the compiled agent targets `bun-linux-x64` or `bun-linux-arm64` in `agent/package.json` and `scripts/manage.sh`.
- Vercel is a supported Next.js platform mode selected by `VERCEL=1`; `frontend/next.config.js` omits standalone output in this mode and `frontend/src/server/runtimePaths.ts` uses ephemeral `/tmp/miobridge` storage unless Redis REST is configured.

**Package Manager:**
- Bun 1.0.30 with a root workspace containing `frontend`; use root scripts from `package.json` for the active application.
- Lockfile: present at `bun.lock`.

## Frameworks

**Core:**
- Next.js ^15.3.4 - the sole full-stack application, using Pages Router, SSR, API routes, Node-only server services, rewrites, and standalone output; see `frontend/src/pages/` and `frontend/next.config.js`.
- React ^19.1.0 and React DOM ^19.1.0 - dashboard UI in `frontend/src/components/` and page shells in `frontend/src/pages/`.
- Node.js built-in HTTP server - the compiled child-node agent has no runtime framework or runtime npm dependencies; see `agent/src/server.ts`.
- Tailwind CSS ^4.1.11 plus PostCSS ^8.5.6 - utility processing around the project-specific CSS variables in `frontend/src/styles/globals.css`, configured by `frontend/postcss.config.js` and `frontend/tailwind.config.js`.

**Testing:**
- Vitest ^4.1.9 - frontend, API, service, and component tests configured by `frontend/vitest.config.ts`; node tests use Node environment and component tests switch to jsdom.
- Bun test - agent unit tests under `agent/src/__tests__/`, invoked by `agent/package.json`.
- Testing Library React ^16.3.2 and jest-dom ^6.9.1 - DOM behavior and accessibility assertions in `frontend/src/components/**/__tests__/`.
- Custom integration/E2E harnesses - distributed HTTP flow in `scripts/e2e-distributed.sh` and Chrome DevTools Protocol browser flow in `scripts/e2e-browser.mjs`.

**Build/Dev:**
- Next.js compiler/build - `bun run build` invokes `frontend` build and then `scripts/prepare-standalone.sh`; local development runs Next on port 3001.
- TypeScript compiler - strict checking is configured independently in `frontend/tsconfig.json` and `agent/tsconfig.json`; run the root `typecheck` script for the active app.
- Bun compiler - emits self-contained Linux agent binaries from `agent/src/server.ts` using scripts in `agent/package.json` and `scripts/build-agent.sh`.
- oxlint ^1.6.0 - lints `frontend/src/` from root scripts and `.github/workflows/ci.yml`.
- GitHub Actions - serial lint, typecheck, and standalone build verification in `.github/workflows/ci.yml`.

## Key Dependencies

**Critical:**
- `yaml` ^2.8.0 - parses and emits Clash and application data inside `frontend/src/server/services/mihomoService.ts` and related services.
- `axios` ^1.10.0 - retrieves external subscription content with timeout/response controls in `frontend/src/server/services/mihomoService.ts`.
- `fs-extra` ^11.3.0 - runtime directory, generated subscription, backup, node-state, and deploy artifact filesystem operations throughout `frontend/src/server/services/`.
- `ssh2` (resolved through the declared `node-ssh` dependency tree, with direct `ssh2` imports) - SSH deployment and diagnosis channel in `frontend/src/server/services/deployManager.ts`.
- `winston` ^3.17.0 - rotating local file and console logging in `frontend/src/server/utils/logger.ts`.
- `node-cron` ^4.2.0 - scheduled subscription refresh initialized from `frontend/src/instrumentation-node.ts`.

**Infrastructure:**
- `mihomo` external binary - required for subscription conversion, Clash generation, validation, and health/version checks in `frontend/src/server/services/mihomoService.ts`; search order is `MIOBRIDGE_MIHOMO_PATH`, YAML configuration, `~/.config/miobridge/bin/`, repository locations, then `PATH`.
- `yq` external binary - validates, reads, and edits `~/.config/miobridge/config.yaml` in `frontend/src/server/services/yamlService.ts` and `scripts/lib/config.sh`.
- `sing-box` optional external binary - collects source URLs and status for main-node operation through `frontend/src/server/services/singBoxService.ts` and `frontend/src/server/services/adapters/singBoxAdapter.ts`.
- Sing-box, Xray, and V2Ray kernel configuration files - child-agent source inputs parsed by adapters in `frontend/src/server/services/adapters/` and reused through `agent/tsconfig.json` path mappings.
- systemd and optional nginx - Linux service lifecycle is rendered from `config/miobridge.service.template`; optional reverse proxy/static file serving uses `config/nginx.conf.template`.
- Upstash Redis or Vercel KV REST API - optional shared persistence implemented with native `fetch` in `frontend/src/server/services/stateStore.ts`, without a Redis SDK.
- Radix UI, `class-variance-authority`, `clsx`, and `tailwind-merge` - composable UI primitives under `frontend/src/components/ui/`.
- `@iconify/react`, `lucide-react`, Motion, Recharts, Monaco Editor, Sonner, and react-resizable-panels - dashboard icons, animation, charts, editing, notifications, and layout declared in `frontend/package.json`.

## Configuration

**Environment:**
- Primary runtime configuration is YAML at `~/.config/miobridge/config.yaml`, resolved through `frontend/src/server/runtimePaths.ts` and loaded by `frontend/src/server/services/yamlService.ts`; `MIOBRIDGE_CONFIG_DIR` overrides the base directory.
- Agent configuration defaults to `~/.config/miobridge-agent/agent.yaml`; `MIOBRIDGE_AGENT_CONFIG` overrides it in `agent/src/server.ts`.
- Runtime data is rooted at `~/.config/miobridge/`: `www/` outputs, `backup/`, `log/`, `bin/`, `dist/`, configuration, and `nodes.yaml`; the template is `config.yaml.example`.
- HMAC shared secrets are stored in agent/node YAML state or supplied to main-node API routes through `MIOBRIDGE_NODE_SECRET`; never place real secrets in committed examples.
- Optional platform variables are `UPSTASH_REDIS_REST_URL` plus `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` plus `KV_REST_API_TOKEN`; `GITHUB_TOKEN` optionally authenticates GitHub release requests.
- Build/download controls are `MIOBRIDGE_MIHOMO_VERSION`, `MIOBRIDGE_MIHOMO_DOWNLOAD_URL`, `MIOBRIDGE_FORCE_MIHOMO_DOWNLOAD`, and `MIOBRIDGE_MIHOMO_PATH`; deployment metadata uses Vercel-provided Git variables and injected `NEXT_PUBLIC_GIT_COMMIT` / `NEXT_PUBLIC_BUILD_TIME`.

**Build:**
- `package.json` is the root command surface and Bun workspace manifest; `frontend/package.json` owns the active application dependencies and scripts.
- `frontend/next.config.js` selects Vercel versus standalone behavior, traces `frontend/bin/mihomo`, externalizes Node packages, defines compatibility rewrites, and injects build metadata.
- `frontend/tsconfig.json`, `agent/tsconfig.json`, `frontend/vitest.config.ts`, `frontend/postcss.config.js`, and `frontend/tailwind.config.js` configure compilation, tests, and styles.
- `scripts/prepare-standalone.sh` copies `.next/static` and `public` into standalone runtime output; preserve this step in any deployment path.

## Platform Requirements

**Development:**
- Use Bun 1.0.30-compatible tooling and Node.js >=18; install from the repository root with `bun install`.
- `git`, `tar`, `unzip`, and either `curl` or `wget` are required by the shell installer in `scripts/lib/system.sh`; Linux x64/arm64 and limited armv7 binary mapping exists in `scripts/lib/install.sh`.
- A usable `mihomo` binary is required for real conversion/build validation; `scripts/ensure-mihomo-binary.mjs` can obtain a matching GitHub release asset.
- Use `bun run lint`, `bun run typecheck`, `bun run build`, `cd frontend && bun test`, and `cd agent && bun test`; do not run an unrelated root TypeScript project.

**Production:**
- Self-hosted deployment runs the Next standalone server under Node with `PORT`, `HOSTNAME=0.0.0.0`, and `NODE_ENV=production`, normally managed by systemd through `scripts/manage.sh` and `config/miobridge.service.template`.
- The installed standalone tree must include `frontend/server.js`, its traced `node_modules`, `frontend/.next/static`, and `frontend/public`; see `scripts/prepare-standalone.sh` and `scripts/lib/build.sh`.
- Main nodes require writable `~/.config/miobridge`, `mihomo`, and `yq`; child nodes require the compiled `miobridge-agent`, systemd, configured kernel files, and public HTTP reachability on the agent port.
- Vercel builds only the Next application mode and cannot rely on durable local files; configure Redis REST for shared state and treat spawned local binaries/filesystem-heavy behavior as platform constrained.

---

*Stack analysis: 2026-07-11*
