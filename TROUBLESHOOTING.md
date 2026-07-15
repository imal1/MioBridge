# Troubleshooting

Start with the CLI-owned service state:

```bash
miobridge status --json
miobridge dashboard status --json
journalctl --user -u miobridge-dashboard.service -n 100 --no-pager
curl -fsS http://127.0.0.1:3000/health
```

## Common checks

- `clash.yaml` is missing: run `miobridge setup`, verify mihomo is available,
  then run `miobridge update`.
- The dashboard will not start: inspect `miobridge dashboard status` for provider
  or port errors and then check its user journal.
- A remote Agent is offline: verify its public Agent port is reachable. Normal
  health and source checks use Agent HTTP plus HMAC, not SSH fallback.
- SSH detection or deployment failed: verify the saved SSH credential, host key,
  sudo access, and outbound access to the MioBridge Release assets. On the child node,
  inspect `journalctl -u miobridge-agent -n 100 --no-pager`.
- `Dashboard provider is not installed`: reinstall the release or use
  `miobridge upgrade` when a newer release is available.

## Install a specific release

Use the same verified release path as upgrade:

```bash
MIOBRIDGE_VERSION=1.0.0 miobridge upgrade
```

The command verifies `SHA256SUMS` before replacing the CLI and dashboard.
