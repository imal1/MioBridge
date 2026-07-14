#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT_DIR/packages/frontend/dist"
OUTPUT="${1:-$ROOT_DIR/dist/dashboard-provider}"
VERSION="${MIOBRIDGE_DASHBOARD_VERSION:-$(node -p "require('$ROOT_DIR/packages/frontend/package.json').version")}"

if [[ ! -f "$SOURCE/index.html" ]]; then
  echo "Vite dashboard not found; run 'bun run build' first" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"
tmp="$(mktemp -d "${OUTPUT}.tmp.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/artifact"
cp -R "$SOURCE/." "$tmp/artifact/"

cat > "$tmp/provider.json" <<EOF
{
  "schemaVersion": 2,
  "dashboardVersion": "$VERSION",
  "artifactRoot": "artifact",
  "spaFallback": true,
  "reservedPaths": ["/api", "/health", "/subscription.txt", "/clash.yaml", "/raw.txt"]
}
EOF

rm -rf "$OUTPUT"
mv "$tmp" "$OUTPUT"
trap - EXIT
echo "Vite dashboard provider packaged at $OUTPUT"
