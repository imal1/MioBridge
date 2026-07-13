#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${MIOBRIDGE_RELEASE_VERSION:-${1:-}}"
OUTPUT_DIR="${MIOBRIDGE_RELEASE_DIR:-$ROOT_DIR/dist/cli-release}"
BUN_CMD="${MIOBRIDGE_BUN_CMD:-bun}"

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

build_core() {
  # CLI source imports the public compiled core package. Rebuild it here so a
  # release never inherits an untracked or stale workspace dist/ directory.
  rm -rf "$ROOT_DIR/packages/core/dist"
  "$BUN_CMD" run --cwd "$ROOT_DIR/packages/core" build
}

if [[ -z "${MIOBRIDGE_BINARY_X64:-}" || -z "${MIOBRIDGE_BINARY_ARM64:-}" ]]; then
  need "$BUN_CMD"
  build_core
fi

mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT_DIR"/miobridge-"$VERSION"-linux-*.tar.gz "$OUTPUT_DIR/SHA256SUMS"

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
    "$BUN_CMD" build "$ROOT_DIR/packages/cli/src/main.ts" --compile --target="$target" --outfile "$binary"
  fi
  chmod 0755 "$binary"
  printf '%s\n' "$VERSION" > "$stage/VERSION"
  # Normalize inputs so repeated packaging produces stable archives on GNU tar.
  touch -t 197001010000 "$binary" "$stage/VERSION" 2>/dev/null || true
  if tar --version 2>/dev/null | grep -q 'GNU tar'; then
    tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -czf "$OUTPUT_DIR/$archive" -C "$stage" VERSION miobridge
  else
    COPYFILE_DISABLE=1 tar -czf "$OUTPUT_DIR/$archive" -C "$stage" VERSION miobridge
  fi
  rm -rf "$stage"
  trap - RETURN
}

build_one x64 bun-linux-x64 "${MIOBRIDGE_BINARY_X64:-}"
build_one arm64 bun-linux-arm64 "${MIOBRIDGE_BINARY_ARM64:-}"

(
  cd "$OUTPUT_DIR"
  LC_ALL=C shasum -a 256 miobridge-"$VERSION"-linux-*.tar.gz > SHA256SUMS
)
echo "CLI release $VERSION written to $OUTPUT_DIR"
