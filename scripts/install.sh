#!/bin/sh
set -eu

REPOSITORY="${MIOBRIDGE_REPOSITORY:-imal1/miobridge}"
VERSION="${MIOBRIDGE_VERSION:-}"
INSTALL_DIR="${MIOBRIDGE_INSTALL_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${MIOBRIDGE_CONFIG_DIR:-$HOME/.config/miobridge}"
BASE_URL="${MIOBRIDGE_RELEASE_BASE_URL:-}"
RUN_SETUP=1

usage() {
  cat <<'EOF'
Install the self-contained MioBridge CLI and its required runtime dependencies.

Usage: install.sh [--version VERSION] [--repository OWNER/REPO]
                  [--install-dir DIR] [--config-dir DIR]
                  [--base-url URL] [--skip-setup]

With no version, the latest GitHub release is installed. Environment equivalents:
MIOBRIDGE_VERSION, MIOBRIDGE_REPOSITORY, MIOBRIDGE_INSTALL_DIR,
MIOBRIDGE_CONFIG_DIR, MIOBRIDGE_RELEASE_BASE_URL.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) VERSION=${2:?missing version}; shift 2 ;;
    --repository) REPOSITORY=${2:?missing repository}; shift 2 ;;
    --install-dir) INSTALL_DIR=${2:?missing install directory}; shift 2 ;;
    --config-dir) CONFIG_DIR=${2:?missing config directory}; shift 2 ;;
    --base-url) BASE_URL=${2:?missing base URL}; shift 2 ;;
    --skip-setup) RUN_SETUP=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$(uname -s)" in Linux) ;; *) echo "MioBridge CLI releases support Linux only" >&2; exit 1 ;; esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "unsupported Linux architecture: $(uname -m)" >&2; exit 1 ;;
esac

download() {
  if command -v curl >/dev/null 2>&1; then curl -fL --retry 3 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -O "$2" "$1"
  else echo "curl or wget is required to download MioBridge" >&2; return 1
  fi
}

download_stdout() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 "$1"
  elif command -v wget >/dev/null 2>&1; then wget -qO- "$1"
  else echo "curl or wget is required to download MioBridge" >&2; return 1
  fi
}

if [ -z "$VERSION" ]; then
  [ -z "$BASE_URL" ] || { echo "--version is required with --base-url" >&2; exit 2; }
  VERSION="$(download_stdout "https://api.github.com/repos/$REPOSITORY/releases/latest" \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' \
    | head -n 1)"
  [ -n "$VERSION" ] || { echo "could not resolve the latest MioBridge release" >&2; exit 1; }
fi

case "$VERSION" in
  *[!0-9A-Za-z._-]*|'') echo "invalid MioBridge version: $VERSION" >&2; exit 2 ;;
esac

archive="miobridge-$VERSION-linux-$arch.tar.gz"
if [ -z "$BASE_URL" ]; then
  BASE_URL="https://github.com/$REPOSITORY/releases/download/v$VERSION"
fi

tmp="$(mktemp -d "${TMPDIR:-/tmp}/miobridge-install.XXXXXX")"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT HUP INT TERM

download "$BASE_URL/$archive" "$tmp/$archive"
download "$BASE_URL/SHA256SUMS" "$tmp/SHA256SUMS"

expected="$(awk -v name="$archive" '$2 == name || $2 == "*" name { print $1; exit }' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || { echo "checksum entry missing for $archive" >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$tmp/$archive" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then actual="$(shasum -a 256 "$tmp/$archive" | awk '{print $1}')"
else echo "sha256sum or shasum is required to verify MioBridge" >&2; exit 1
fi
[ "$actual" = "$expected" ] || { echo "checksum verification failed for $archive" >&2; exit 1; }

mkdir "$tmp/extract"
tar -xzf "$tmp/$archive" -C "$tmp/extract"
[ -f "$tmp/extract/miobridge" ] && [ ! -L "$tmp/extract/miobridge" ] \
  || { echo "release does not contain a regular miobridge executable" >&2; exit 1; }
[ -f "$tmp/extract/dashboard/provider.json" ] && [ ! -L "$tmp/extract/dashboard/provider.json" ] \
  || { echo "release does not contain a dashboard provider" >&2; exit 1; }
[ -f "$tmp/extract/dashboard/artifact/index.html" ] && [ ! -L "$tmp/extract/dashboard/artifact/index.html" ] \
  || { echo "release does not contain dashboard assets" >&2; exit 1; }
if find "$tmp/extract/dashboard" -type l -print | grep -q .; then
  echo "release dashboard contains an unsupported symbolic link" >&2
  exit 1
fi
chmod 0755 "$tmp/extract/miobridge"

binary="$INSTALL_DIR/miobridge"
metadata="$INSTALL_DIR/.miobridge-cli-version"
dashboard="$CONFIG_DIR/dist/dashboard"
mkdir -p "$INSTALL_DIR"
mkdir -p "$CONFIG_DIR/dist"
candidate="$INSTALL_DIR/.miobridge.new.$$"
backup="$INSTALL_DIR/.miobridge.old.$$"
metadata_candidate="$INSTALL_DIR/.miobridge-version.new.$$"
metadata_backup="$INSTALL_DIR/.miobridge-version.old.$$"
dashboard_candidate="$CONFIG_DIR/dist/.dashboard.new.$$"
dashboard_backup="$CONFIG_DIR/dist/.dashboard.old.$$"
cp "$tmp/extract/miobridge" "$candidate"
cp -R "$tmp/extract/dashboard" "$dashboard_candidate"
chmod 0755 "$candidate"
printf '%s\n' "$VERSION" > "$metadata_candidate"
[ ! -e "$binary" ] || mv "$binary" "$backup"
[ ! -e "$metadata" ] || mv "$metadata" "$metadata_backup"
[ ! -e "$dashboard" ] || mv "$dashboard" "$dashboard_backup"
if mv "$candidate" "$binary" \
  && mv "$metadata_candidate" "$metadata" \
  && mv "$dashboard_candidate" "$dashboard"; then
  rm -f "$backup" "$metadata_backup"
  rm -rf "$dashboard_backup"
else
  rm -f "$binary" "$candidate" "$metadata_candidate"
  rm -rf "$dashboard" "$dashboard_candidate"
  [ ! -e "$backup" ] || mv "$backup" "$binary"
  [ ! -e "$metadata_backup" ] || mv "$metadata_backup" "$metadata"
  [ ! -e "$dashboard_backup" ] || mv "$dashboard_backup" "$dashboard"
  echo "installation failed; previous MioBridge CLI restored" >&2
  exit 1
fi

echo "MioBridge CLI $VERSION installed at $binary"
echo "Dashboard provider installed at $dashboard"
if [ "$RUN_SETUP" -eq 1 ]; then
  echo "Installing required runtime dependencies through the CLI..."
  "$binary" setup --yes
fi

case ":${PATH:-}:" in
  *:"$INSTALL_DIR":*) ;;
  *) echo "Add $INSTALL_DIR to PATH, then run: miobridge --help" ;;
esac
echo "Future upgrades and removal: miobridge upgrade | miobridge uninstall"
