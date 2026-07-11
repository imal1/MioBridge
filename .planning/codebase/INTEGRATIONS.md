# External Integrations

**Analysis Date:** 2026-07-11

## APIs & External Services

**Proxy subscription sources:**
- User-configured subscription URLs - downloaded and normalized before mihomo conversion in `frontend/src/server/services/mihomoService.ts` and aggregated in `frontend/src/server/services/mioBridgeService.ts`.
  - SDK/Client: Axios ^1.10.0 and native `fetch`
  - Auth: Embedded URL credentials or provider-specific headers are not centrally modeled; configuration is stored in local YAML/state.

**GitHub releases and artifacts:**
- GitHub REST Releases API - discovers the latest MioBridge agent and MetaCubeX/mihomo releases in `frontend/src/server/services/updateChecker.ts`, `scripts/ensure-mihomo-binary.mjs`, and `scripts/lib/install.sh`.
  - SDK/Client: Native `fetch`, `curl`, or `wget`; no GitHub SDK
  - Auth: Optional `GITHUB_TOKEN`
- GitHub release/codeload downloads - obtains mihomo, Bun, yq, source tarballs, and agent deployment artifacts from GitHub in `scripts/lib/install.sh`, `scripts/lib/config.sh`, and `frontend/src/server/services/deployManager.ts`.
  - SDK/Client: Native `fetch`, `curl`, `wget`, and SSH-side shell tools
  - Auth: `GITHUB_TOKEN` for supported API/download calls; public downloads otherwise

**Remote MioBridge agents:**
- Child-node Agent HTTP API - the main node calls `http://<host>:<agentPort>/api/status`, `/api/health`, `/api/urls`, `/api/update`, and `/api/logs` through `frontend/src/server/services/nodeManager.ts`.
  - SDK/Client: Native `fetch`
  - Auth: Per-node HMAC-SHA256 shared secret stored in `nodes.yaml` and agent YAML; signing/verification is implemented in `frontend/src/server/middleware/hmac.ts` and `agent/src/hmac.ts`.
- Server-sent events - browsers subscribe to `/api/cluster/events` for cluster status updates through `frontend/src/lib/useClusterSSE.ts` and `frontend/src/pages/api/cluster/events.ts`.
  - SDK/Client: Browser `EventSource`
  - Auth: None detected

**Remote host administration:**
- SSH/SFTP - deploys and diagnoses child agents, uploads configuration/artifacts, installs kernels, and controls systemd in `frontend/src/server/services/deployManager.ts`.
  - SDK/Client: Direct `ssh2` `Client`
  - Auth: Password or private-key material represented by `SshAuthMethod`/node state; uploaded private keys are validated by `frontend/src/server/services/sshCredential.ts`.
- Community kernel installers - optional Sing-box, Xray, and V2Ray install scripts are fetched and executed remotely from URLs declared in `frontend/src/server/services/deployManager.ts`.
  - SDK/Client: Remote `wget` plus Bash over SSH
  - Auth: None

**Kernel executables:**
- MetaCubeX/mihomo - converts subscriptions to Clash YAML, validates generated configs, and reports version/health in `frontend/src/server/services/mihomoService.ts`; the child agent can invoke `mihomo convert` in `agent/src/handlers/update.ts`.
  - SDK/Client: Spawned external process
  - Auth: Not applicable
- Sing-box, Xray, and V2Ray - source node URLs/configurations are collected from local files or kernel commands by `frontend/src/server/services/adapters/` and `agent/src/handlers/urls.ts`.
  - SDK/Client: Spawned commands and local JSON file parsing
  - Auth: Local filesystem/process permissions

## Data Storage

**Databases:**
- No relational or document database is used.
- Optional Upstash Redis / Vercel KV-compatible REST storage persists `nodes.yaml`-equivalent state and deployment progress across Vercel instances in `frontend/src/server/services/stateStore.ts` and `frontend/src/server/services/deployProgressStore.ts`.
  - Connection: `UPSTASH_REDIS_REST_URL` with `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` with `KV_REST_API_TOKEN`
  - Client: Native `fetch` issuing Redis REST commands; keys are namespaced with `miobridge:`.

**File Storage:**
- Local filesystem is the default and authoritative self-hosted store under `~/.config/miobridge`, overridable with `MIOBRIDGE_CONFIG_DIR`; path resolution is centralized in `frontend/src/server/runtimePaths.ts`.
- `config.yaml`, `nodes.yaml`, generated `www/raw.txt`, `www/subscription.txt`, `www/clash.yaml`, timestamped backups, logs, binaries, and standalone distribution files are managed by `frontend/src/server/services/`, `scripts/manage.sh`, and `scripts/lib/`.
- The child agent reads `~/.config/miobridge-agent/agent.yaml` by default and kernel configs from system locations declared in `agent/src/config.ts`.
- Vercel without Redis falls back to ephemeral `/tmp/miobridge`; this state disappears with function instances as documented in `frontend/src/server/runtimePaths.ts` and `frontend/src/server/services/stateStore.ts`.

**Caching:**
- No dedicated cache service is used.
- In-process singleton state and maps provide fast-path service/deployment state in `frontend/src/server/services/stateStore.ts`, `frontend/src/server/services/deployProgressStore.ts`, and singleton services; Redis is persistence/coordination rather than a response cache.

## Authentication & Identity

**Auth Provider:**
- Custom HMAC authentication for machine-to-machine main/child node requests.
  - Implementation: Requests carry timestamp and SHA-256 HMAC headers, checked with timing-safe comparison and replay-window validation in `frontend/src/server/middleware/hmac.ts` and `agent/src/hmac.ts`; secrets are per-node values in YAML state.
- Custom SSH credentials for deployment/diagnosis.
  - Implementation: Password and private-key modes are accepted by cluster API types; keys are parsed/validated in `frontend/src/server/services/sshCredential.ts` and consumed only by `frontend/src/server/services/deployManager.ts`.
- Dashboard user authentication is not detected; pages and most browser-facing API routes are exposed without an identity provider. HMAC on `/api/status` and `/api/update` is conditional on `MIOBRIDGE_NODE_SECRET`.

## Monitoring & Observability

**Error Tracking:**
- No hosted error-tracking service is integrated.

**Logs:**
- Winston writes `combined.log` and `error.log` with size-based rotation under the configured MioBridge log directory and mirrors output to console in `frontend/src/server/utils/logger.ts`.
- The Linux service is observable through systemd/journald; main-node remote log retrieval calls the agent `/api/logs`, which reads `journalctl -u miobridge-agent` in `agent/src/handlers/logs.ts`.
- Health/status endpoints are `/api/health`, `/api/status`, and compatibility rewrite `/health`; cluster aggregation is exposed by routes under `frontend/src/pages/api/cluster/`.
- Deployment progress is held in memory and optionally Redis, then streamed/polled through `frontend/src/pages/api/cluster/deploy/progress.ts` and `frontend/src/pages/api/cluster/events.ts`.

## CI/CD & Deployment

**Hosting:**
- Primary self-hosting: Next.js `output: 'standalone'` on a Linux Node.js service, installed under `~/.config/miobridge/dist` and managed through `scripts/manage.sh`, `scripts/server-deploy.sh`, and `config/miobridge.service.template`.
- Optional nginx reverse proxy/static serving is templated in `config/nginx.conf.template`; Next rewrites preserve `/subscription.txt`, `/clash.yaml`, `/raw.txt`, and `/health` when nginx is absent.
- Vercel: the linked project metadata exists at `.vercel/project.json`; `frontend/next.config.js` detects `VERCEL=1` and lets the platform's Next builder produce the deployment instead of standalone output.
- Child nodes: compiled Bun Linux executable installed as `miobridge-agent`, configured under `~/.config/miobridge-agent` or deployment-selected paths, and controlled by systemd via `frontend/src/server/services/deployManager.ts`.

**CI Pipeline:**
- GitHub Actions workflow `.github/workflows/ci.yml` runs on pull requests to `main` and manual dispatch.
- The pipeline installs Bun 1.0.30, runs oxlint, runs frontend TypeScript checking, builds with Node.js 20, and verifies `frontend/.next/standalone/frontend/server.js`.
- No automatic production deployment job is detected; deployment is script/operator driven.

## Environment Configuration

**Required env vars:**
- Self-hosted Next runtime: `NODE_ENV=production`, `HOSTNAME=0.0.0.0`, and `PORT` are used by the standalone server/service launch path in `package.json` and `scripts/manage.sh`.
- No environment variable is universally required for application configuration because defaults come from `~/.config/miobridge/config.yaml`.
- `MIOBRIDGE_CONFIG_DIR` overrides the main runtime directory; `MIOBRIDGE_MIHOMO_PATH` overrides binary discovery; `MIOBRIDGE_AGENT_CONFIG` overrides the agent YAML location.
- `MIOBRIDGE_NODE_SECRET` enables HMAC protection for node-facing main-app status/update routes.
- Redis persistence requires one complete pair: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` + `KV_REST_API_TOKEN`.
- Optional artifact/update controls: `GITHUB_TOKEN`, `MIOBRIDGE_MIHOMO_VERSION`, `MIOBRIDGE_MIHOMO_DOWNLOAD_URL`, `MIOBRIDGE_FORCE_MIHOMO_DOWNLOAD`, and `MIOBRIDGE_AGENT_SOURCE_TARBALL`.
- Platform/build variables consumed by code include `VERCEL`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_REPO_OWNER`, `VERCEL_GIT_REPO_SLUG`, `NEXT_RUNTIME`, `NEXT_PUBLIC_GIT_COMMIT`, and `NEXT_PUBLIC_BUILD_TIME`.

**Secrets location:**
- Main application/node configuration and HMAC values live in permission-restricted files under `~/.config/miobridge`, especially `config.yaml` and `nodes.yaml`; file state writes use mode `0600` in `frontend/src/server/services/stateStore.ts`.
- Child HMAC secret lives in the agent YAML selected by `MIOBRIDGE_AGENT_CONFIG`, normally under `~/.config/miobridge-agent/`; the committed `agent/agent.yaml.example` contains only an empty placeholder.
- Cloud Redis and GitHub credentials are environment variables supplied by the hosting/service environment; no committed secret store is detected.
- SSH credentials are represented in node configuration/state used by `frontend/src/server/services/nodeManager.ts`; validate private keys through `frontend/src/server/services/sshCredential.ts` and keep runtime state out of version control.

## Webhooks & Callbacks

**Incoming:**
- No third-party webhooks are registered.
- Internal/public HTTP entry points include Next API routes under `frontend/src/pages/api/`, compatibility file/health rewrites in `frontend/next.config.js`, and child-agent endpoints in `agent/src/server.ts`; these are operational APIs rather than external webhook callbacks.

**Outgoing:**
- Subscription HTTP(S) downloads initiated by `frontend/src/server/services/mihomoService.ts`.
- GitHub release metadata and artifact downloads initiated by `frontend/src/server/services/updateChecker.ts`, `scripts/ensure-mihomo-binary.mjs`, installer scripts, and `frontend/src/server/services/deployManager.ts`.
- HMAC-signed HTTP requests from the main node to child agents initiated by `frontend/src/server/services/nodeManager.ts`.
- SSH connections and remote shell/SFTP operations initiated by `frontend/src/server/services/deployManager.ts`.
- Redis REST commands initiated by `frontend/src/server/services/stateStore.ts` when cloud persistence variables are configured.

---

*Integration audit: 2026-07-11*
