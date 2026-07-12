#!/usr/bin/env bash
# Run inside scripts/systemd-e2e.Dockerfile after its systemd PID 1 is ready.
set -euo pipefail

CLI_BINARY="${1:?usage: e2e-cli-systemd.sh /path/to/miobridge}"
TEST_USER="${MIOBRIDGE_E2E_USER:-miobridge-e2e}"
TEST_HOME="/home/$TEST_USER"
TEST_PORT="${MIOBRIDGE_E2E_PORT:-3000}"

fail() { echo "systemd E2E: $*" >&2; exit 1; }
run_as_user() {
  local uid
  uid="$(id -u "$TEST_USER")"
  runuser -u "$TEST_USER" -- env \
    HOME="$TEST_HOME" \
    XDG_RUNTIME_DIR="/run/user/$uid" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" \
    "$@"
}
wait_for() {
  local attempts="$1"; shift
  local attempt
  for attempt in $(seq 1 "$attempts"); do
    "$@" && return 0
    sleep 1
  done
  return 1
}

test "$(uname -s)" = Linux || fail "requires Linux"
test -x "$CLI_BINARY" || fail "missing compiled CLI: $CLI_BINARY"
systemctl is-system-running --wait || test "$(systemctl is-system-running)" = degraded || fail "systemd did not start"

useradd --create-home --shell /bin/bash "$TEST_USER"
install -d -m 0755 -o "$TEST_USER" -g "$TEST_USER" "$TEST_HOME/.local/bin"
install -m 0755 -o "$TEST_USER" -g "$TEST_USER" "$CLI_BINARY" "$TEST_HOME/.local/bin/miobridge"
loginctl enable-linger "$TEST_USER"
uid="$(id -u "$TEST_USER")"
wait_for 20 test -S "/run/user/$uid/bus" || fail "user systemd bus did not appear after enable-linger"

provider_dir="$TEST_HOME/.config/miobridge/dist/dashboard"
managed_bin="$TEST_HOME/.config/miobridge/bin"
install -d -m 0755 -o "$TEST_USER" -g "$TEST_USER" "$provider_dir/artifact" "$managed_bin"
cat > "$managed_bin/bun" <<'EOF'
#!/bin/sh
printf '%s\n' "$0 $*" > "$MIOBRIDGE_CONFIG_DIR/bun-provider-invocation"
exec /usr/bin/node "$@"
EOF
chmod 0755 "$managed_bin/bun"
cat > "$provider_dir/provider.json" <<'EOF'
{"schemaVersion":1,"dashboardVersion":"e2e","artifactRoot":"artifact","executable":"bun","entrypoint":"server.js","args":[],"environment":{"host":"HOSTNAME","port":"PORT","configDir":"MIOBRIDGE_CONFIG_DIR","configFile":"CONFIG_FILE"},"healthUrl":"http://{host}:{port}/health","compatibilityUrls":["http://{host}:{port}/health","http://{host}:{port}/subscription.txt","http://{host}:{port}/clash.yaml","http://{host}:{port}/raw.txt"]}
EOF
cat > "$provider_dir/artifact/server.js" <<'EOF'
const http = require('node:http');
const routes = new Set(['/health', '/subscription.txt', '/clash.yaml', '/raw.txt']);
http.createServer((request, response) => {
  response.statusCode = routes.has(request.url) ? 200 : 404;
  response.end(request.url === '/health' ? 'ok' : 'fixture');
}).listen(Number(process.env.PORT), process.env.HOSTNAME);
EOF
chown -R "$TEST_USER:$TEST_USER" "$TEST_HOME/.config"

# Separate invocations model a fresh shell after logout/reconnect. Linger keeps
# the user manager and service discoverable without a root service or PID file.
run_as_user "$TEST_HOME/.local/bin/miobridge" dashboard status --json > /tmp/status-before.json
grep -q '"state":"stopped"' /tmp/status-before.json || fail "expected initially stopped user service"
run_as_user "$TEST_HOME/.local/bin/miobridge" dashboard start
run_as_user "$TEST_HOME/.local/bin/miobridge" dashboard start
wait_for 20 curl -fsS "http://127.0.0.1:$TEST_PORT/health" >/dev/null || fail "provider never became healthy"
test -s "$TEST_HOME/.config/miobridge/bun-provider-invocation" || fail "provider did not use managed Bun"
for path in /subscription.txt /clash.yaml /raw.txt; do
  curl -fsS "http://127.0.0.1:$TEST_PORT$path" >/dev/null || fail "compatibility URL failed: $path"
done
run_as_user "$TEST_HOME/.local/bin/miobridge" dashboard status --json > /tmp/status-reconnect.json
grep -q '"state":"running"' /tmp/status-reconnect.json || fail "service not discoverable after reconnect"
grep -q '"linger":true' /tmp/status-reconnect.json || fail "status did not report linger"
run_as_user "$TEST_HOME/.local/bin/miobridge" dashboard stop
run_as_user "$TEST_HOME/.local/bin/miobridge" dashboard stop
run_as_user "$TEST_HOME/.local/bin/miobridge" dashboard status --json > /tmp/status-stopped.json
grep -q '"state":"stopped"' /tmp/status-stopped.json || fail "idempotent stop failed"

# A failed provider must direct operators to its user journal. Unit-level tests
# cover the stable broken-state payload; this proves real user-systemd guidance.
printf 'process.exit(23);\n' > "$provider_dir/artifact/server.js"
chown "$TEST_USER:$TEST_USER" "$provider_dir/artifact/server.js"
if run_as_user "$TEST_HOME/.local/bin/miobridge" dashboard start > /tmp/provider-failure.out 2>&1; then
  fail "broken provider unexpectedly started"
fi
grep -q 'journalctl --user -u miobridge-dashboard.service' /tmp/provider-failure.out || {
  cat /tmp/provider-failure.out >&2
  fail "provider failure omitted journal guidance"
}

# Removing only provider files leaves headless CLI/config ownership intact.
rm -rf "$provider_dir"
run_as_user "$TEST_HOME/.local/bin/miobridge" status --json > /tmp/headless-after-removal.json
grep -q '"subscriptionExists"' /tmp/headless-after-removal.json || fail "headless status failed after provider removal"
test -d "$TEST_HOME/.config/miobridge" || fail "runtime base unexpectedly removed"
echo "Linux user-systemd dashboard E2E passed"
