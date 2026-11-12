---
name: config-patterns
description: Current configuration conventions
metadata:
  type: project
---

# Config Patterns

- Runtime config is `~/.config/miobridge/config.yaml`.
- Runtime data/log/backup/dist paths are under `~/.config/miobridge/`.
- `MIOBRIDGE_CONFIG_DIR` can override the runtime base dir for isolated tests.
- Core runtime paths are resolved per instance through `createRuntimePaths`;
  the CLI owns the platform policy.
- Binary lookup order is configured path, `~/.config/miobridge/bin/`, repo
  `bin/`, then PATH.
- Protocol kernels use 233boy management wrappers at `/usr/local/bin/<kernel>`;
  their core, aggregate config, and profiles live under `/etc/<kernel>/bin`,
  `/etc/<kernel>/config.json`, and `/etc/<kernel>/conf` respectively.
- Core parses and updates `config.yaml` directly; production does not require an
  external YAML executable.
- Release-owned Mihomo static settings, policy groups, and rules live only in
  `~/.config/miobridge/template.yaml`; it is a release-owned, runtime-read-only
  resource that upgrades replace atomically. Core reads it without writing,
  reserves `proxies`, and replaces `__MIOBRIDGE_NODES__` placeholders only in
  the generated document.
- Whole-document config writes pass YAML syntax, strict known-shape, and field
  semantic validation before an atomic raw-source replacement.
- `app.port` defaults the dashboard port. The user unit passes
  `MIOBRIDGE_DASHBOARD_HOST` and `MIOBRIDGE_DASHBOARD_PORT` explicitly.
- SSH passwords and uploaded private keys use StateStore keys
  `ssh-credentials/<nodeId>`; nodes.yaml stores only `authMethod` and
  `credentialRef`. Password and private-key authentication are mutually exclusive.
- Non-root local and SSH credentials use StateStore references. Root passwords
  and private keys remain in memory for one deployment task and are then cleared.
- Agent configs use a non-empty, duplicate-free `kernels` list of sing-box,
  Xray, and/or V2Ray entries, each with an optional config path. A node config
  may use the exact `kernels: []` draft form until its first successful deploy.
- A node's optional `proxy` block in nodes.yaml (`server`, `sni`, `certVerify:
  strict|insecure`, `protocols`, `displayName`) describes how clients reach its
  proxies in generated subscriptions. It is independent of `host` (the Agent
  management address), every field is explicit with "unset = keep the
  kernel-reported value", and an empty block is never persisted. `sni` and
  `certVerify` apply only to certificate-based TLS links, never to Reality.
  `sni` must be a hostname, never an IP literal. The API replaces the whole
  block (`null` clears it); `miobridge nodes proxy <id>` edits field by field
  (empty value / `inherit` / `all` clears one field, `--clear` clears all).
  Both write the same nodes.yaml and go through `validateNodeProxy`, which the
  E2E harness reuses too — keep a single validator.

- 2026-11-08: config.yaml is the subscription-policy source; legacy JSON is migrated once. Editable schema fields require a consumer mapping. Cron uses croner with app.timezone. Prefer template.user.yaml; upgrades preserve template.yaml and stage template.yaml.new. auth.yaml is mode 0600 and separate from exported configuration.
