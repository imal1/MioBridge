# MioBridge Diagnostic

Run a comprehensive diagnostic of the CLI-owned MioBridge dashboard service.

## Steps

1. Check CLI and dashboard state:
   ```bash
   miobridge status --json
   miobridge dashboard status --json
   ```

2. Check the public health endpoint:
   ```bash
   PORT=$(grep 'port:' ~/.config/miobridge/config.yaml 2>/dev/null | awk '{print $2}' | head -1 || echo "3000")
   curl -fsS "http://localhost:${PORT:-3000}/health" | python3 -m json.tool
   ```

3. Check current CI and Linux lifecycle runs:
   ```bash
   gh run list -w ci.yml -L5
   gh run list -w cli-systemd-e2e.yml -L5
   ```

4. Check dashboard logs:
   ```bash
   journalctl --user -u miobridge-dashboard.service --since "10 min ago" --no-pager
   ```

5. Check the installed release identity:
   ```bash
   miobridge --version
   cat ~/.local/bin/.miobridge-cli-version
   ```

6. Summarize findings with the failing layer: CLI, provider, user-systemd, or network.
