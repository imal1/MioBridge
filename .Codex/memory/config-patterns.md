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
- Core parses and updates `config.yaml` directly; production does not require an
  external YAML executable.
- `app.port` defaults the dashboard port. The user unit passes
  `MIOBRIDGE_DASHBOARD_HOST` and `MIOBRIDGE_DASHBOARD_PORT` explicitly.
- SSH passwords and uploaded private keys use StateStore keys
  `ssh-credentials/<nodeId>`; nodes.yaml stores only `authMethod` and
  `credentialRef`. Password and private-key authentication are mutually exclusive.
- Agent configs use a non-empty, duplicate-free `kernels` list of sing-box,
  Xray, and/or V2Ray entries, each with an optional config path. A node config
  may use the exact `kernels: []` draft form until its first successful deploy.
- The local-node choice lives in `nodes.yaml`, not `config.yaml`. Its reserved ID
  is `local`, host is `127.0.0.1`, and its monitored source kernel is sing-box.
