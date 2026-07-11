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
- On Vercel without `MIOBRIDGE_CONFIG_DIR`, runtime scratch/log paths fall back
  to `/tmp/miobridge` to avoid read-only home directory failures.
- Binary lookup order is configured path, `~/.config/miobridge/bin/`, repo
  `bin/`, then PATH.
- `PORT` can override the app port for systemd/Next startup.
- Uploaded SSH private keys use StateStore keys `ssh-keys/<nodeId>`; nodes.yaml
  stores only `authMethod` and `credentialRef`. Password and private-key SSH
  authentication are mutually exclusive.
