#!/bin/sh
set -eu

REPOSITORY="${MIOBRIDGE_REPOSITORY:-imal1/miobridge}"
VERSION="${MIOBRIDGE_VERSION:-}"
INSTALL_DIR="${MIOBRIDGE_INSTALL_DIR:-$HOME/.local/bin}"
BASE_URL="${MIOBRIDGE_RELEASE_BASE_URL:-}"
ACTION=install

usage() {
  cat <<'EOF'
Install the self-contained MioBridge CLI.
Usage: install-cli.sh [--version VERSION] [--repository OWNER/REPO]
                      [--install-dir DIR] [--base-url URL] [--uninstall]
Environment equivalents: MIOBRIDGE_VERSION, MIOBRIDGE_REPOSITORY,
MIOBRIDGE_INSTALL_DIR, MIOBRIDGE_RELEASE_BASE_URL.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) VERSION=${2:?missing version}; shift 2 ;;
    --repository) REPOSITORY=${2:?missing repository}; shift 2 ;;
    --install-dir) INSTALL_DIR=${2:?missing install directory}; shift 2 ;;
    --base-url) BASE_URL=${2:?missing base URL}; shift 2 ;;
    --uninstall) ACTION=uninstall; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

binary="$INSTALL_DIR/miobridge"
metadata="$INSTALL_DIR/.miobridge-cli-version"
if [ "$ACTION" = uninstall ]; then
  rm -f "$binary" "$metadata"
  echo "MioBridge CLI removed; configuration and data were preserved."
  exit 0
fi

[ -n "$VERSION" ] || { echo "--version is required for a pinned, reproducible install" >&2; exit 2; }
case "$(uname -s)" in Linux) ;; *) echo "MioBridge CLI releases support Linux only" >&2; exit 1 ;; esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "unsupported Linux architecture: $(uname -m)" >&2; exit 1 ;;
esac

archive="miobridge-$VERSION-linux-$arch.tar.gz"
if [ -z "$BASE_URL" ]; then
  BASE_URL="https://github.com/$REPOSITORY/releases/download/v$VERSION"
fi
tmp="$(mktemp -d "${TMPDIR:-/tmp}/miobridge-install.XXXXXX")"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT HUP INT TERM

download() {
  if command -v curl >/dev/null 2>&1; then curl -fL --retry 3 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -O "$2" "$1"
  else echo "curl or wget is required to download MioBridge" >&2; return 1
  fi
}
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
[ -f "$tmp/extract/miobridge" ] && [ ! -L "$tmp/extract/miobridge" ] || { echo "release does not contain a regular miobridge executable" >&2; exit 1; }
chmod 0755 "$tmp/extract/miobridge"
mkdir -p "$INSTALL_DIR"
candidate="$INSTALL_DIR/.miobridge.new.$$"
backup="$INSTALL_DIR/.miobridge.old.$$"
metadata_candidate="$INSTALL_DIR/.miobridge-version.new.$$"
cp "$tmp/extract/miobridge" "$candidate"
chmod 0755 "$candidate"
printf '%s\n' "$VERSION" > "$metadata_candidate"
if [ -e "$binary" ]; then mv "$binary" "$backup"; fi
if mv "$candidate" "$binary"; then
  if mv "$metadata_candidate" "$metadata"; then
    rm -f "$backup"
  else
    rm -f "$binary" "$metadata_candidate"
    [ ! -e "$backup" ] || mv "$backup" "$binary"
    echo "installation failed; previous MioBridge CLI restored" >&2
    exit 1
  fi
else
  rm -f "$candidate" "$metadata_candidate"
  [ ! -e "$backup" ] || mv "$backup" "$binary"
  echo "installation failed; previous MioBridge CLI restored" >&2
  exit 1
fi
echo "MioBridge CLI $VERSION installed at $binary"
