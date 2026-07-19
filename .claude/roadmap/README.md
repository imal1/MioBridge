# MioBridge Roadmap

This is the compact planning reference. Keep detailed architecture and operating
rules in `AGENTS.md`, `README.md`, `CHANGELOG.md`, and `.Codex/memory/`.

## Status

- ✅ Shipped
- 🟡 Partial or active
- 🔲 Planned
- ⏸ Deferred

## Version Summary

| Version | Theme | Status | Notes |
| --- | --- | --- | --- |
| v0.1 | Minimum usable subscription converter | ✅ | mihomo conversion, generated outputs, and dashboard |
| v0.2 | AI memory and contributor docs | ✅ | Moved durable memory to `.Codex/memory/`; docs were intentionally shortened |
| v1.0 | Distributed node control plane | ✅ | Main node, Agent, HMAC, NodeManager, remote deployment, adapters |
| v1.1 | Auth and API keys | ⏸ | Deferred while the product is single-user; revisit before public/multi-user use |
| v1.2 | Online config management | ✅ | Schema drafts, validation, atomic save, restart hints, import/export with redaction, restore last-good (`/api/config/restore`); released as `v1.2.0` |
| v1.3 | Subscription source management | 🔲 | Only kernel-collected sources with dedupe today; remote URLs, manual input, file upload, source health still needed |
| v1.4 | Output customization and rules | 🔲 | Clash templates, proxy groups, DNS, rule editing, export variants |
| v1.5 | Monitoring and alerts | 🟡 | `/api/metrics` with 24h/7d/30d windows, history and summaries; four-source logs UI; webhook notifications with delivery history. Alert rules still pending |
| v1.6 | API docs and API consistency | ✅ | Dynamic OpenAPI 3.1 (`/api/openapi.json`), standard success/error envelopes, request validation, `X-Request-ID` propagation, idempotency keys |
| v1.7 | Performance and cache | 🔲 | Idempotency keys shipped with v1.6; artifact caching, update locks, progress cleanup jobs remain |
| v1.8 | Production quality | 🟡 | Unit suites (core/CLI/frontend) plus 145-test Playwright E2E gate PRs in CI; coverage thresholds and reports still pending |

## Current Direction

The near-term product is single-user. Prioritize a complete local/control-plane
experience over account systems:

1. Make Mio Garden the primary web control surface.
2. Keep all UI on shadcn/ui primitives, Iconify icons, Botanical Garden tokens,
   and focused motion interactions.
3. Keep HTTP routes in the CLI runtime and framework-independent logic in `packages/core`.
4. Preserve compatibility URLs: `/subscription.txt`, `/clash.yaml`, `/raw.txt`,
   and `/health`.

## Shipped Baseline

v0.1 and v1.0 form the stable baseline:

Release tags use full semantic versions; the shipped v1.0 roadmap milestone
maps to the `v1.0.0` GitHub Release.

- One compiled `miobridge` binary owns lifecycle commands and the dashboard HTTP server.
- The dashboard UI is a Vite SPA under `packages/frontend/` and ships with the binary release.
- Runtime data under `~/.config/miobridge`.
- Main node generates `raw.txt`, `subscription.txt`, and `clash.yaml`.
- Child nodes run Agent/kernel and expose source URLs.
- Remote checks use public Agent HTTP plus HMAC; SSH is for deploy/diagnosis.
- GitHub Actions build checksummed CLI archives containing the dashboard assets.

## Active Work

### Mio Garden UI

- Replace the old dashboard-first flow with task pages: overview,
  subscription, nodes, deploy, logs, config, and API.
- Keep the panel style flat and Material 3 inspired: elevated/filled surfaces,
  no visible borders, contrast through lighter botanical surfaces.
- Use shadcn/ui components for inputs, tabs, charts, dialogs, resizable panels,
  toasts, tables, and badges.

### Config Management

Goal: edit runtime config without SSH.

Acceptance:

- Read/write `~/.config/miobridge/config.yaml` through service APIs.
- Validate YAML and supported fields before write.
- Backup before every write and support rollback.
- Hot-reload safe fields such as source lists, cron, log level, and timeouts.
- Clearly mark fields that require service restart.

### Subscription Sources

Goal: stop relying on only local sing-box config names.

Acceptance:

- Support sing-box config, remote URL, manual text, and uploaded node files.
- Test each source before saving.
- Track last status, node count, latency, and failure reason.
- Dedupe nodes and support simple rename/filter rules.

### Output Customization

Goal: let users shape generated Clash output.

Acceptance:

- Provide several built-in templates.
- Allow proxy group and rule editing.
- Validate generated `clash.yaml` with mihomo.
- Export YAML, install URL, and QR code where useful.

### Observability

Goal: diagnose from the web UI before SSH.

Acceptance:

- Search and filter logs by level, time, and keyword.
- Record update history, duration, node count, and errors.
- Add `/api/metrics` or equivalent structured metrics.
- Add dashboard alerts and optional webhook notifications.

### API and Quality

Goal: make the service easier to integrate and safer to change.

Acceptance:

- Publish OpenAPI documentation for stable endpoints.
- Standardize API errors and request validation.
- Add unit, integration, and E2E coverage for key flows.
- Include tests in CI once stable enough to gate PRs.

## Deferred

Auth, API key management, multi-user accounts, quotas, billing, plugin markets,
and hosted-platform features are not near-term priorities. Revisit auth before
opening an instance beyond trusted single-user access.

## Future Ideas

- Docker image and one-command install path.
- Multi-language UI/docs.
- Additional protocol parsers.
- Template marketplace for Clash rules and output profiles.
