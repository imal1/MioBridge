#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/miobridge-e2e.XXXXXX")"
MAIN_DIR="$TMP_DIR/main"
AGENT_DIR="$TMP_DIR/agent"
MAIN_PORT="${MAIN_PORT:-43101}"
AGENT_PORT="${AGENT_PORT:-43102}"
SECRET="distributed-e2e-secret-32chars"

MAIN_PID=""
AGENT_PID=""

cleanup() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    echo "--- main.log ---" >&2
    tail -n 120 "$TMP_DIR/main.log" >&2 || true
    echo "--- agent.log ---" >&2
    tail -n 120 "$TMP_DIR/agent.log" >&2 || true
  fi
  if [[ -n "$MAIN_PID" ]] && kill -0 "$MAIN_PID" 2>/dev/null; then
    kill "$MAIN_PID" 2>/dev/null || true
  fi
  if [[ -n "$AGENT_PID" ]] && kill -0 "$AGENT_PID" 2>/dev/null; then
    kill "$AGENT_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$MAIN_DIR/bin" "$MAIN_DIR/www" "$AGENT_DIR"

cat > "$MAIN_DIR/bin/mihomo" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  -v|version)
    echo "Mihomo Meta e2e"
    ;;
  -t)
    exit 0
    ;;
  *)
    echo "mihomo e2e stub"
    ;;
esac
SH
chmod +x "$MAIN_DIR/bin/mihomo"

cat > "$MAIN_DIR/bin/yq" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
file="${@: -1}"
if [[ "$*" == *"--output-format=json"* ]]; then
  node - "$file" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
if (!fs.existsSync(file)) {
  console.log('{}');
  process.exit(0);
}
console.log('{}');
NODE
  exit 0
fi

node - "$file" <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
function dump(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    return value.map(item => {
      if (item && typeof item === 'object') {
        const lines = dump(item, indent + 2).split('\n');
        return `${pad}- ${lines[0].trimStart()}\n${lines.slice(1).join('\n')}`;
      }
      return `${pad}- ${JSON.stringify(item)}`;
    }).join('\n');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, child]) => {
      if (child && typeof child === 'object') return `${pad}${key}:\n${dump(child, indent + 2)}`;
      return `${pad}${key}: ${JSON.stringify(child)}`;
    }).join('\n');
  }
  return `${pad}${JSON.stringify(value)}`;
}
console.log(dump(data));
NODE
SH
chmod +x "$MAIN_DIR/bin/yq"

cat > "$AGENT_DIR/xray.json" <<'JSON'
{
  "inbounds": [
    {
      "tag": "e2e-xray",
      "protocol": "vless",
      "port": 443,
      "settings": {
        "clients": [
          { "id": "00000000-0000-4000-8000-000000000001", "flow": "" }
        ]
      },
      "streamSettings": {
        "network": "tcp",
        "security": "tls",
        "tlsSettings": { "serverName": "example.com" }
      }
    }
  ]
}
JSON

cat > "$AGENT_DIR/v2ray.json" <<'JSON'
{
  "inbounds": [
    {
      "tag": "e2e-v2ray",
      "protocol": "vless",
      "port": 8443,
      "settings": {
        "clients": [
          { "id": "00000000-0000-4000-8000-000000000003", "flow": "" }
        ]
      },
      "streamSettings": {
        "network": "tcp",
        "security": "tls",
        "tlsSettings": { "serverName": "v2ray.example.com" }
      }
    }
  ]
}
JSON

cat > "$AGENT_DIR/agent.yaml" <<YAML
node:
  id: "agent-e2e"
  name: "Agent E2E"
  secret: "$SECRET"
kernels:
  - type: "xray"
    configPath: "$AGENT_DIR/xray.json"
  - type: "v2ray"
    configPath: "$AGENT_DIR/v2ray.json"
mihomo:
  path: "$MAIN_DIR/bin/mihomo"
port: $AGENT_PORT
YAML

cat > "$MAIN_DIR/nodes.yaml" <<YAML
nodes:
  - id: "agent-e2e"
    name: "Agent E2E"
    host: "0.0.0.0"
    port: $AGENT_PORT
    secret: "$SECRET"
    kernels:
      - type: "xray"
      - type: "v2ray"
    location: "local-e2e"
    enabled: true
YAML

if [[ ! -f "$ROOT_DIR/frontend/.next/standalone/frontend/server.js" ]]; then
  echo "standalone build is missing; run: bun run build" >&2
  exit 1
fi

MIOBRIDGE_AGENT_CONFIG="$AGENT_DIR/agent.yaml" bun "$ROOT_DIR/agent/src/server.ts" > "$TMP_DIR/agent.log" 2>&1 &
AGENT_PID="$!"

PORT="$MAIN_PORT" \
HOSTNAME="127.0.0.1" \
NODE_ENV="production" \
MIOBRIDGE_CONFIG_DIR="$MAIN_DIR" \
node "$ROOT_DIR/frontend/.next/standalone/frontend/server.js" > "$TMP_DIR/main.log" 2>&1 &
MAIN_PID="$!"

wait_for_http() {
  local url="$1"
  for _ in $(seq 1 80); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  echo "Timed out waiting for $url" >&2
  echo "--- main.log ---" >&2
  tail -n 80 "$TMP_DIR/main.log" >&2 || true
  echo "--- agent.log ---" >&2
  tail -n 80 "$TMP_DIR/agent.log" >&2 || true
  return 1
}

wait_for_http "http://127.0.0.1:$AGENT_PORT/api/health"
wait_for_http "http://127.0.0.1:$MAIN_PORT/health"

node - "$MAIN_PORT" "$AGENT_PORT" "$MAIN_DIR" <<'NODE'
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mainPort = process.argv[2];
const agentPort = process.argv[3];
const mainDir = process.argv[4];
const base = `http://127.0.0.1:${mainPort}`;

async function json(pathname, init) {
  const res = await fetch(`${base}${pathname}`, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  assert(res.ok, `${pathname} failed: ${res.status} ${text}`);
  return body;
}

(async () => {
  const health = await json('/health');
  assert.equal(health.status, 'healthy');

  const agentUrlsResponse = await fetch(`http://127.0.0.1:${agentPort}/api/urls`);
  assert.equal(agentUrlsResponse.status, 200);
  const agentUrls = await agentUrlsResponse.json();
  assert.deepEqual(agentUrls.data.sources.map(source => source.kernel), ['xray', 'v2ray']);
  assert.equal(agentUrls.data.kernels.find(kernel => kernel.type === 'xray').nodesCount, 1);
  assert.equal(agentUrls.data.kernels.find(kernel => kernel.type === 'v2ray').nodesCount, 1);

  const cluster = await json('/api/cluster/status');
  assert.equal(cluster.success, true);
  const remote = cluster.data.nodes.find(node => node.nodeId === 'agent-e2e');
  assert(remote, 'remote Agent is missing from cluster status');
  assert.equal(remote.online, true);
  assert.equal(remote.nodesCount, 2);

  const update = await json('/api/update');
  assert.equal(update.success, true, JSON.stringify(update));
  assert.equal(update.data.success, true, JSON.stringify(update));
  assert.equal(update.data.nodesCount, 2, JSON.stringify(update));
  assert.equal(update.data.clashGenerated, true, JSON.stringify(update));

  const raw = await fetch(`${base}/raw.txt`).then(res => {
    assert.equal(res.status, 200);
    return res.text();
  });
  assert(raw.includes('vless://00000000-0000-4000-8000-000000000001@0.0.0.0:443'), raw);
  assert(raw.includes('vless://00000000-0000-4000-8000-000000000003@0.0.0.0:8443'), raw);

  const subscription = await fetch(`${base}/subscription.txt`).then(res => {
    assert.equal(res.status, 200);
    return res.text();
  });
  const decodedSubscription = Buffer.from(subscription, 'base64').toString('utf8');
  assert(decodedSubscription.includes('#e2e-xray'), decodedSubscription);
  assert(decodedSubscription.includes('#e2e-v2ray'), decodedSubscription);

  const clash = await fetch(`${base}/clash.yaml`).then(res => {
    assert.equal(res.status, 200);
    return res.text();
  });
  assert(clash.includes('proxies:'), clash);
  assert(clash.includes('local-e2e e2e-xray'), clash);
  assert(clash.includes('local-e2e e2e-v2ray'), clash);

  for (const file of ['raw.txt', 'subscription.txt', 'clash.yaml']) {
    assert(fs.existsSync(path.join(mainDir, 'www', file)), `${file} was not generated`);
  }
})();
NODE

echo "distributed e2e passed"
