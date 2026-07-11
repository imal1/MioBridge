# Codebase Concerns

**Analysis Date:** 2026-07-11

## Tech Debt

**Dashboard and core runtime are tightly coupled:**
- Issue: Core conversion, node management, SSH deployment, persistence, and lifecycle behavior live under the Next.js application rather than behind a standalone command/API boundary.
- Files: `frontend/src/server/services/mioBridgeService.ts`, `frontend/src/server/services/nodeManager.ts`, `frontend/src/server/services/deployManager.ts`, `frontend/src/pages/api/**`
- Impact: The web application is mandatory for core operations, serverless/demo deployment inherits host-management capabilities it should not expose, and a lightweight CLI cannot reuse a stable public core without importing Next-specific types and routes.
- Fix approach: Extract framework-independent application commands into `frontend/src/server/**` initially, then expose them through a Linux `miobridge` CLI; keep API routes as thin adapters and make dashboard installation/startup optional.

**Oversized service classes:**
- Issue: `NodeManager` combines YAML parsing/serialization, credential references, health polling, deployment state transitions, HMAC request construction, and cluster aggregation; `MihomoService` and `DeployManager` also combine process/network orchestration with policy.
- Files: `frontend/src/server/services/nodeManager.ts`, `frontend/src/server/services/mihomoService.ts`, `frontend/src/server/services/deployManager.ts`
- Impact: Changes have broad regression surfaces, private-method-heavy tests become brittle, and CLI extraction requires pulling in unrelated behavior.
- Fix approach: Split repositories, credential storage, agent client, kernel runner, and deployment workflow behind narrow interfaces while retaining `XxxService.getInstance()` facades for callers.

**Manual YAML mutation:**
- Issue: Node configuration is serialized and patched with indentation-sensitive string manipulation despite the project already depending on `yaml`.
- Files: `frontend/src/server/services/nodeManager.ts`
- Impact: New fields, comments, quoting edge cases, or formatting changes can silently corrupt `nodes.yaml`; the parser and writer must evolve in lockstep.
- Fix approach: Parse to a typed document with the `yaml` package, validate the resulting schema, update the object/document, and atomically replace the file.

**Stale root dependencies and scripts:**
- Issue: The root manifest still declares Express, CORS, Helmet, compression, axios, and legacy TypeScript tooling although the active service is Next.js; root `test` reports that tests are not configured.
- Files: `package.json`, `AGENTS.md`
- Impact: Install size and maintenance surface overstate the product's needs, dependency alerts can be irrelevant, and contributors may run a misleading test command.
- Fix approach: Remove dependencies unused by scripts/workspaces, route root tests to `frontend` and `agent`, and make the future CLI package the explicit root runtime artifact.

## Known Bugs

**Replay protection rejects legitimate concurrent requests and permits trivial timestamp poisoning:**
- Symptoms: Two valid requests using the same millisecond timestamp cannot both authenticate; an invalid signature can reserve a timestamp before verification so the later valid request is rejected as a replay.
- Files: `frontend/src/server/middleware/hmac.ts`, `agent/src/hmac.ts`
- Trigger: Send an invalid signed request with a current timestamp, then send a correctly signed request with that timestamp; or send same-timestamp requests for different nodes.
- Workaround: Always generate unique timestamps and retry with a new timestamp. Correct fix is to verify first, then store a replay key containing node ID plus signature/nonce with expiry.

**Configuration update is process-local:**
- Symptoms: A successful `POST /api/configs` mutates an imported in-memory object but does not persist to `config.yaml`, so the value disappears on restart and differs across instances.
- Files: `frontend/src/pages/api/configs.ts`, `frontend/src/server/config/index.ts`
- Trigger: Update configs through the endpoint, then restart the server or read from another serverless instance.
- Workaround: Edit persistent YAML through `YamlService`; replace the endpoint mutation with an atomic service-level update.

**Serverless deployment work can terminate after the response:**
- Symptoms: `/api/cluster/deploy` returns HTTP 202 and continues SSH deployment in an unawaited promise; a serverless runtime may freeze or terminate the invocation before status and node state are finalized.
- Files: `frontend/src/pages/api/cluster/deploy.ts`, `frontend/src/server/services/deployProgressStore.ts`
- Trigger: Start a deployment on Vercel or any request-scoped runtime and allow the invocation to end.
- Workaround: Run deployment only in the persistent Linux service/CLI. Demo hosting should disable mutations; durable deployments require an external worker/queue.

## Security Considerations

**Management surface has no administrator authentication:**
- Risk: Any network client reaching the dashboard can add nodes, submit SSH credentials, run remote installations/commands, read logs/configuration, update kernels, or alter cluster state.
- Files: `frontend/src/pages/api/cluster/**`, `frontend/src/pages/api/yaml/config.ts`, `frontend/src/pages/api/configs.ts`, `frontend/src/pages/api/logs.ts`
- Current mitigation: Agent-facing requests use per-node HMAC in selected paths; no equivalent dashboard/API authorization layer is present.
- Recommendations: Bind management to loopback by default, add session/API-token authorization and CSRF protection to all management routes, explicitly classify public subscription endpoints, and make Vercel demo routes read-only with synthetic data.

**Sensitive SSH material is persisted alongside ordinary application state:**
- Risk: Passwords are serialized in `nodes.yaml`; uploaded private keys are stored by the generic state store. Redis-backed storage transmits recoverable plaintext values and filesystem backups can capture credentials.
- Files: `frontend/src/server/services/nodeManager.ts`, `frontend/src/server/services/stateStore.ts`, `frontend/src/server/services/sshCredential.ts`
- Current mitigation: Files are chmod `0600`, private keys use references rather than being returned by normal node responses, and API response sanitization removes passwords in the add-node path.
- Recommendations: Prefer SSH agent/key paths for local CLI use, encrypt stored secrets with a separately managed key, redact credentials at every serialization boundary, exclude credential keys from backups, and document rotation/deletion behavior.

**HMAC identity and replay model is incomplete:**
- Risk: `x-node-id` is required but is not included in the signed payload or checked against an expected identity; replay state is process-local and resets or diverges across instances. Frontend localhost bypass also considers forwarded address input when socket data is absent.
- Files: `frontend/src/server/middleware/hmac.ts`, `agent/src/hmac.ts`
- Current mitigation: SHA-256 HMAC, a 30-second clock window, and timing-safe digest comparison are implemented.
- Recommendations: Sign a canonical payload containing node ID, method, normalized path, body hash, timestamp, and random nonce; validate node identity; persist nonce expiry where multiple instances exist; base localhost trust only on a trusted socket/proxy configuration.

**Downloaded executables lack integrity verification:**
- Risk: Bun and mihomo archives from mutable `latest` URLs are executed after transport-only validation; a compromised release/account/CDN or unexpected asset can become code execution during install/build.
- Files: `scripts/lib/install.sh`, `scripts/ensure-mihomo-binary.mjs`, `frontend/src/server/services/deployManager.ts`
- Current mitigation: HTTPS, basic archive extraction checks, and post-install version execution are used.
- Recommendations: Pin supported versions, verify published SHA-256/checksum signatures before extraction, use unique secure temporary directories, and record installed artifact versions and hashes.

**First-use SSH host-key trust is vulnerable to interception:**
- Risk: An empty `hostKey` accepts and records whichever key answers first, so the initial deployment can trust a man-in-the-middle.
- Files: `frontend/src/server/services/deployManager.ts`, `frontend/src/server/services/nodeManager.ts`
- Current mitigation: Subsequent connections compare the stored key.
- Recommendations: Display the fingerprint for explicit confirmation, support preconfigured fingerprints/known_hosts, and reject unattended first contact unless the user explicitly enables TOFU.

## Performance Bottlenecks

**Cluster polling fans out on every client interval:**
- Problem: Every SSE connection independently calls `getClusterStatus()` initially and every 30 seconds, causing repeated remote health/status checks for the same nodes.
- Files: `frontend/src/pages/api/cluster/events.ts`, `frontend/src/server/services/nodeManager.ts`, `frontend/src/lib/useClusterSSE.ts`
- Cause: There is no shared poller, result cache, or subscriber fan-out.
- Improvement path: Maintain one bounded-concurrency cluster poller per process, cache short-lived results, broadcast changes to subscribers, and apply per-node timeout/backoff.

**Redis key discovery is O(total keyspace):**
- Problem: State listing uses Redis `KEYS` for prefixes.
- Files: `frontend/src/server/services/stateStore.ts`
- Cause: The implementation assumes only a handful of nodes and avoids a cursor/index.
- Improvement path: Use `SCAN` or maintain explicit sets/indexes for credentials and progress records before shared Redis is used beyond demo scale.

**External conversion runs in request paths:**
- Problem: Subscription updates spawn conversion binaries and may occupy an API request for up to 120 seconds.
- Files: `frontend/src/pages/api/update.ts`, `frontend/src/server/services/mioBridgeService.ts`, `frontend/src/server/services/mihomoService.ts`
- Cause: Conversion is synchronous from the route's perspective and has no coalescing or job queue.
- Improvement path: Move generation into the CLI/service scheduler, deduplicate concurrent updates, generate into temporary files, and atomically publish completed artifacts.

## Fragile Areas

**Deployment orchestration and remote shell construction:**
- Files: `frontend/src/server/services/deployManager.ts`, `scripts/manage.sh`, `scripts/lib/*.sh`
- Why fragile: It spans SSH authentication, privilege escalation, architecture detection, downloads, uploads, systemd, kernel config paths, and compensating cleanup across heterogeneous Linux hosts.
- Safe modification: Centralize shell quoting and artifact metadata, keep every remote step idempotent, preserve atomic temporary-file replacement, and test root/non-root plus x64/arm64 paths.
- Test coverage: Unit tests mock SSH heavily; no repeat-install, interrupted-download, distro matrix, or real systemd integration suite is present.

**File state durability:**
- Files: `frontend/src/server/services/stateStore.ts`, `frontend/src/server/services/nodeManager.ts`, `frontend/src/server/services/deployProgressStore.ts`
- Why fragile: File writes are direct rather than temp-file-plus-rename, locks are only process-local, and the Redis lock expires after 10 seconds and deliberately fails open after contention.
- Safe modification: Use atomic replacement and fsync where durability matters; add lock renewal/fencing and fail closed for configuration/credential mutations.
- Test coverage: Existing store tests cover behavior but not crash consistency, multi-process writers, expired-lock overlap, or Redis outages during transactions.

**Agent routing and protocol handling:**
- Files: `agent/src/server.ts`, `agent/src/handlers/urls.ts`, `frontend/src/server/services/adapters/*.ts`
- Why fragile: Routing uses exact raw URL comparisons except logs, and protocol URL conversion has many optional transport/TLS fields with divergent kernel schemas.
- Safe modification: Parse URLs with `URL`, centralize protocol normalization, validate kernel configuration schemas, and use fixture-based round-trip tests.
- Test coverage: Handler/adaptor tests exist, but malformed query encoding, IPv6 hosts, uncommon transports, and newer kernel schema versions remain exposed.

## Scaling Limits

**Single-host control plane:**
- Current capacity: Code comments and implementations assume a cluster of only a handful of nodes and one persistent main process.
- Limit: Per-process singleton state, local files, SSE polling per browser, and SSH work initiated by API processes do not coordinate reliably across replicas.
- Scaling path: Keep the default CLI deployment single-host and explicit; if multi-instance operation is required, introduce durable jobs, shared state with fencing, one poller/worker ownership model, and event fan-out.

**In-memory queues and replay sets:**
- Current capacity: Mutex chains and HMAC replay timestamps last only for one process lifetime; deploy callbacks are not durable.
- Limit: Restart loses coordination/progress, multiple processes can execute overlapping work, and maps/sets grow until periodic coarse cleanup.
- Scaling path: Persist idempotency/deployment records with TTL, use durable worker leases, and bound per-node concurrency.

## Dependencies at Risk

**Broad semver ranges and unpinned toolchain:**
- Risk: Most runtime packages use caret ranges, agent types use `latest`, and installers resolve latest external binaries, allowing non-reproducible builds/deployments.
- Impact: Clean installs at different times can produce different behavior or incompatible generated artifacts.
- Migration plan: Pin Bun, TypeScript, Next.js, binary releases, and critical runtime dependencies through the lockfile/release manifest; update intentionally with CI across supported Linux architectures.

**Native/host binary coupling:**
- Risk: Core output depends on `mihomo`, `yq`, and optionally kernel binaries with OS/architecture-specific distribution and command behavior.
- Impact: Vercel, non-Linux development, minimal distros, and new architectures can build successfully but fail at runtime.
- Migration plan: Make binary capability discovery a first-class CLI command, keep downloads outside the dashboard bundle, verify versions/checksums, and provide clear degraded behavior when optional kernels are absent.

## Missing Critical Features

**Installable Linux CLI boundary:**
- Problem: There is no installed `miobridge` executable providing core conversion/config/update/status operations; users must clone the repository and invoke project scripts or run the full dashboard.
- Blocks: Lightweight headless adoption, stable scripting/automation, clean dependency onboarding, and a truly optional dashboard.

**Optional dashboard lifecycle:**
- Problem: Dashboard start/stop/background management is embedded in full-project systemd/deployment scripts rather than exposed as `miobridge dashboard start|stop|status` with foreground and daemon modes.
- Blocks: A small default installation and clear separation between core service and web UI.

**Explicit demo safety mode:**
- Problem: Vercel builds the same full-stack management application and downloads mihomo rather than a deliberately read-only frontend demo.
- Blocks: Safe public demonstration without exposing state mutation, filesystem/process assumptions, SSH forms, or misleading operational controls.

## Test Coverage Gaps

**CLI installation and lifecycle:**
- What's not tested: Fresh Linux install, dependency prompts, command PATH installation, upgrade/uninstall, headless conversion, dashboard foreground/background start-stop, and idempotent reruns.
- Files: `scripts/install.sh`, `scripts/manage.sh`, `scripts/lib/*.sh`
- Risk: The primary distribution path can fail only on user machines or leave partial services/files.
- Priority: High

**Authorization boundaries:**
- What's not tested: Anonymous denial for management APIs, CSRF behavior, read-only demo restrictions, credential redaction across all endpoints/logs/errors, and per-node HMAC identity binding.
- Files: `frontend/src/pages/api/**`, `frontend/src/server/middleware/hmac.ts`, `agent/src/hmac.ts`
- Risk: Remote command execution or credential disclosure can be introduced unnoticed.
- Priority: High

**Production packaging:**
- What's not tested: Release artifact installation on supported Linux distros/architectures, standalone static/public asset completeness, checksum verification, systemd restart behavior, and Vercel demo-only routing.
- Files: `scripts/prepare-standalone.sh`, `scripts/lib/build.sh`, `scripts/lib/service.sh`, `frontend/next.config.js`
- Risk: CI-level builds can pass while installed or hosted products are unusable or unsafe.
- Priority: High

**Failure and concurrency behavior:**
- What's not tested: Process termination mid-write/deploy, simultaneous node edits/deployments from separate processes, Redis lock expiry, network partitions, and SSE connection fan-out.
- Files: `frontend/src/server/services/stateStore.ts`, `frontend/src/server/services/nodeManager.ts`, `frontend/src/pages/api/cluster/deploy.ts`, `frontend/src/pages/api/cluster/events.ts`
- Risk: State corruption, stale progress, duplicated remote operations, or resource exhaustion appears only under production timing.
- Priority: High

---

*Concerns audit: 2026-07-11*
