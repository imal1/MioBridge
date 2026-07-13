#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT_DIR/packages/frontend/.next/standalone"
OUTPUT="${1:-$ROOT_DIR/dist/dashboard-provider}"
VERSION="${MIOBRIDGE_DASHBOARD_VERSION:-$(node -p "require('$ROOT_DIR/packages/frontend/package.json').version")}"

if [[ ! -f "$SOURCE/frontend/server.js" ]]; then
  echo "standalone dashboard not found; run 'bun run build' first" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"
tmp="$(mktemp -d "${OUTPUT}.tmp.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
cp -R "$SOURCE/." "$tmp/artifact"

cat > "$tmp/provider.json" <<EOF
{
  "schemaVersion": 1,
  "dashboardVersion": "$VERSION",
  "artifactRoot": "artifact",
  "executable": "bun",
  "entrypoint": "frontend/server.js",
  "args": [],
  "environment": {
    "host": "HOSTNAME",
    "port": "PORT",
    "configDir": "MIOBRIDGE_CONFIG_DIR",
    "configFile": "CONFIG_FILE"
  },
  "healthUrl": "http://{host}:{port}/health",
  "compatibilityUrls": [
    "http://{host}:{port}/health",
    "http://{host}:{port}/subscription.txt",
    "http://{host}:{port}/clash.yaml",
    "http://{host}:{port}/raw.txt"
  ]
}
EOF

rm -rf "$OUTPUT"
mv "$tmp" "$OUTPUT"
trap - EXIT
echo "dashboard provider packaged at $OUTPUT"
