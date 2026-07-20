#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${MIOBRIDGE_RELEASE_VERSION:-${1:-}}"
OUTPUT_DIR="${MIOBRIDGE_RELEASE_DIR:-$ROOT_DIR/dist/cli-release}"
BUN_CMD="${MIOBRIDGE_BUN_CMD:-bun}"
DASHBOARD_PROVIDER_DIR="${MIOBRIDGE_DASHBOARD_PROVIDER_DIR:-}"
GENERATED_DASHBOARD_ROOT=""
AGENT_INSTALLER="${MIOBRIDGE_AGENT_INSTALLER:-$ROOT_DIR/scripts/install-agent.sh}"
CLI_INSTALLER="${MIOBRIDGE_CLI_INSTALLER:-$ROOT_DIR/scripts/install.sh}"

cleanup() {
  [[ -z "$GENERATED_DASHBOARD_ROOT" ]] || rm -rf "$GENERATED_DASHBOARD_ROOT"
}
trap cleanup EXIT

if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('$ROOT_DIR/packages/cli/package.json').version" 2>/dev/null || true)"
fi
if [[ -z "$VERSION" || ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "usage: $0 <version> (or set MIOBRIDGE_RELEASE_VERSION)" >&2
  exit 2
fi

need() { command -v "$1" >/dev/null 2>&1 || { echo "required command not found: $1" >&2; exit 1; }; }
need tar
need shasum
need gzip
if [[ -f "$AGENT_INSTALLER" ]]; then
  sh -n "$AGENT_INSTALLER"
elif [[ -f "$ROOT_DIR/agent/src/server.ts" ]]; then
  echo "Agent installer not found: $AGENT_INSTALLER" >&2
  exit 1
fi
[[ -f "$CLI_INSTALLER" ]] || { echo "CLI installer not found: $CLI_INSTALLER" >&2; exit 1; }
sh -n "$CLI_INSTALLER"

build_core() {
  # CLI source imports the public compiled core package. Rebuild it here so a
  # release never inherits an untracked or stale workspace dist/ directory.
  rm -rf "$ROOT_DIR/packages/core/dist"
  "$BUN_CMD" run --cwd "$ROOT_DIR/packages/core" build
}

build_dashboard() {
  if [[ -n "$DASHBOARD_PROVIDER_DIR" ]]; then
    [[ -f "$DASHBOARD_PROVIDER_DIR/provider.json" && -f "$DASHBOARD_PROVIDER_DIR/artifact/index.html" ]] \
      || { echo "invalid dashboard provider: $DASHBOARD_PROVIDER_DIR" >&2; exit 1; }
    return
  fi
  "$BUN_CMD" run --cwd "$ROOT_DIR/packages/frontend" build
  GENERATED_DASHBOARD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/miobridge-dashboard.XXXXXX")"
  MIOBRIDGE_DASHBOARD_VERSION="$VERSION" bash "$ROOT_DIR/scripts/package-dashboard-provider.sh" "$GENERATED_DASHBOARD_ROOT/provider"
  DASHBOARD_PROVIDER_DIR="$GENERATED_DASHBOARD_ROOT/provider"
}

if [[ -z "${MIOBRIDGE_BINARY_X64:-}" || -z "${MIOBRIDGE_BINARY_ARM64:-}" \
  || -z "${MIOBRIDGE_AGENT_BINARY_X64:-}" || -z "${MIOBRIDGE_AGENT_BINARY_ARM64:-}" ]]; then
  need "$BUN_CMD"
fi
if [[ -z "${MIOBRIDGE_BINARY_X64:-}" || -z "${MIOBRIDGE_BINARY_ARM64:-}" ]]; then
  build_core
fi
build_dashboard

mkdir -p "$OUTPUT_DIR"
rm -f \
  "$OUTPUT_DIR"/miobridge-"$VERSION"-linux-*.tar.gz \
  "$OUTPUT_DIR"/miobridge-agent-"$VERSION"-linux-*.gz \
  "$OUTPUT_DIR/install.sh" \
  "$OUTPUT_DIR/install-agent.sh" \
  "$OUTPUT_DIR/SHA256SUMS"

build_one() {
  local arch="$1" target="$2" override="$3"
  local stage archive binary
  stage="$(mktemp -d "${TMPDIR:-/tmp}/miobridge-release.XXXXXX")"
  archive="miobridge-$VERSION-linux-$arch.tar.gz"
  binary="$stage/miobridge"
  trap 'rm -rf "$stage"' RETURN

  if [[ -n "$override" ]]; then
    cp "$override" "$binary"
  else
    "$BUN_CMD" build "$ROOT_DIR/packages/cli/src/main.ts" --compile --target="$target" \
      --define "process.env.MIOBRIDGE_BUILD_VERSION='$VERSION'" --outfile "$binary"
  fi
  chmod 0755 "$binary"
  printf '%s\n' "$VERSION" > "$stage/VERSION"
  cp -R "$DASHBOARD_PROVIDER_DIR" "$stage/dashboard"
  # Normalize inputs so repeated packaging produces stable archives on GNU tar.
  find "$stage/dashboard" -exec touch -t 197001010000 {} + 2>/dev/null || true
  touch -t 197001010000 "$binary" "$stage/VERSION" 2>/dev/null || true
  if tar --version 2>/dev/null | grep -q 'GNU tar'; then
    tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -czf "$OUTPUT_DIR/$archive" -C "$stage" VERSION dashboard miobridge
  else
    COPYFILE_DISABLE=1 tar -czf "$OUTPUT_DIR/$archive" -C "$stage" VERSION dashboard miobridge
  fi
  rm -rf "$stage"
  trap - RETURN
}

build_one x64 bun-linux-x64 "${MIOBRIDGE_BINARY_X64:-}"
build_one arm64 bun-linux-arm64 "${MIOBRIDGE_BINARY_ARM64:-}"

build_agent() {
  local arch="$1" target="$2" override="$3"
  local binary artifact
  binary="$(mktemp "${TMPDIR:-/tmp}/miobridge-agent.XXXXXX")"
  artifact="$OUTPUT_DIR/miobridge-agent-$VERSION-linux-$arch.gz"
  trap 'rm -f "$binary"' RETURN
  if [[ -n "$override" ]]; then
    cp "$override" "$binary"
  else
    "$BUN_CMD" build "$ROOT_DIR/agent/src/server.ts" --compile --target="$target" \
      --define "process.env.MIOBRIDGE_BUILD_VERSION='$VERSION'" --outfile "$binary"
  fi
  chmod 0755 "$binary"
  gzip -n -c "$binary" > "$artifact"
  rm -f "$binary"
  trap - RETURN
}

build_agent x64 bun-linux-x64 "${MIOBRIDGE_AGENT_BINARY_X64:-}"
build_agent arm64 bun-linux-arm64 "${MIOBRIDGE_AGENT_BINARY_ARM64:-}"

cp "$CLI_INSTALLER" "$OUTPUT_DIR/install.sh"
chmod 0755 "$OUTPUT_DIR/install.sh"

if [[ -f "$AGENT_INSTALLER" ]]; then
  cp "$AGENT_INSTALLER" "$OUTPUT_DIR/install-agent.sh"
  chmod 0755 "$OUTPUT_DIR/install-agent.sh"
fi

(
  cd "$OUTPUT_DIR"
  checksum_files=(
    miobridge-"$VERSION"-linux-*.tar.gz
    miobridge-agent-"$VERSION"-linux-*.gz
  )
  checksum_files+=(install.sh)
  [[ ! -f install-agent.sh ]] || checksum_files+=(install-agent.sh)
  LC_ALL=C shasum -a 256 "${checksum_files[@]}" > SHA256SUMS
)
echo "CLI release $VERSION written to $OUTPUT_DIR"
