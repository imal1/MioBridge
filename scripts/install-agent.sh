#!/bin/sh
set -eu

REPOSITORY="${MIOBRIDGE_REPOSITORY:-imal1/miobridge}"
VERSION="${MIOBRIDGE_VERSION:-}"
BASE_URL="${MIOBRIDGE_RELEASE_BASE_URL:-}"
INSTALL_DIR="${MIOBRIDGE_AGENT_INSTALL_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${MIOBRIDGE_AGENT_CONFIG_DIR:-$HOME/.config/miobridge-agent}"
UNIT_PATH="${MIOBRIDGE_AGENT_UNIT_PATH:-${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/miobridge-agent.service}"
SYSTEMCTL="${MIOBRIDGE_AGENT_SYSTEMCTL:-systemctl}"
CONFIG_SOURCE=""
NODE_ID=""
NODE_NAME=""
SECRET_FILE=""
PORT="3001"
PORT_SET=0
KERNEL_ARGUMENTS=""
MUTATED=0
REPLACE_CONFIG=0

usage() {
  cat <<'EOF'
Install or repair only the MioBridge Agent on a Linux child node.

Usage: install-agent.sh [--config agent.yaml] [--version VERSION]
                        [--repository OWNER/REPO] [--base-url URL]
                        [--install-dir DIR] [--config-dir DIR]

Independent configuration mode:
  install-agent.sh --node-id ID --node-name NAME --secret-file FILE
                   [--kernel TYPE:CONFIG_PATH]... [--port PORT]

The installer downloads a checksum-covered Agent binary, validates the
configuration, installs a user systemd unit, restarts the Agent, and verifies /health.
It never installs MioBridge CLI, Dashboard, Bun, mihomo, or protocol kernels.
It runs entirely as the current user and does not require sudo.
EOF
}

need_value() {
  [ "$#" -ge 2 ] && [ -n "$2" ] || { echo "$1 requires a value" >&2; exit 2; }
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --config) need_value "$@"; CONFIG_SOURCE=$2; shift 2 ;;
    --version) need_value "$@"; VERSION=$2; shift 2 ;;
    --repository) need_value "$@"; REPOSITORY=$2; shift 2 ;;
    --base-url) need_value "$@"; BASE_URL=$2; shift 2 ;;
    --install-dir) need_value "$@"; INSTALL_DIR=$2; shift 2 ;;
    --config-dir) need_value "$@"; CONFIG_DIR=$2; shift 2 ;;
    --node-id) need_value "$@"; NODE_ID=$2; shift 2 ;;
    --node-name) need_value "$@"; NODE_NAME=$2; shift 2 ;;
    --secret-file) need_value "$@"; SECRET_FILE=$2; shift 2 ;;
    --kernel)
      need_value "$@"
      KERNEL_ARGUMENTS="${KERNEL_ARGUMENTS}${KERNEL_ARGUMENTS:+
}$2"
      shift 2
      ;;
    --port) need_value "$@"; PORT=$2; PORT_SET=1; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    --secret) echo "--secret is not supported; use --secret-file" >&2; exit 2 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$(uname -s)" in Linux) ;; *) echo "MioBridge Agent releases support Linux only" >&2; exit 1 ;; esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "unsupported Linux architecture: $(uname -m)" >&2; exit 1 ;;
esac

for command in "$SYSTEMCTL" gzip awk sed mktemp mv cp chmod mkdir rm dirname head id cat sleep; do
  command -v "$command" >/dev/null 2>&1 || { echo "required command not found: $command" >&2; exit 1; }
done

systemctl_user() {
  XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" "$SYSTEMCTL" --user "$@"
}

if ! systemctl_user show-environment >/dev/null 2>&1; then
  echo "user systemd is unavailable; log in as the target user or enable lingering for that account" >&2
  exit 1
fi

download() {
  if command -v curl >/dev/null 2>&1; then curl -fL --retry 3 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -O "$2" "$1"
  else echo "curl or wget is required to download MioBridge Agent" >&2; return 1
  fi
}

download_stdout() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 "$1"
  elif command -v wget >/dev/null 2>&1; then wget -qO- "$1"
  else echo "curl or wget is required to download MioBridge Agent" >&2; return 1
  fi
}

if [ -z "$VERSION" ]; then
  [ -z "$BASE_URL" ] || { echo "--version is required with --base-url" >&2; exit 2; }
  VERSION="$(download_stdout "https://api.github.com/repos/$REPOSITORY/releases/latest" \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' \
    | head -n 1)"
  [ -n "$VERSION" ] || { echo "could not resolve the latest MioBridge release" >&2; exit 1; }
fi

case "$VERSION" in *[!0-9A-Za-z._-]*|'') echo "invalid MioBridge version: $VERSION" >&2; exit 2 ;; esac
case "$PORT" in *[!0-9]*|'') echo "invalid Agent port: $PORT" >&2; exit 2 ;; esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || { echo "invalid Agent port: $PORT" >&2; exit 2; }

binary="$INSTALL_DIR/miobridge-agent"
config="$CONFIG_DIR/agent.yaml"
artifact="miobridge-agent-$VERSION-linux-$arch.gz"
if [ -z "$BASE_URL" ]; then
  BASE_URL="https://github.com/$REPOSITORY/releases/download/v$VERSION"
fi

tmp="$(mktemp -d "${TMPDIR:-/tmp}/miobridge-agent-install.XXXXXX")"
binary_candidate="$INSTALL_DIR/.miobridge-agent.new.$$"
binary_backup="$INSTALL_DIR/.miobridge-agent.old.$$"
config_candidate="$CONFIG_DIR/.agent.yaml.new.$$"
config_backup="$CONFIG_DIR/.agent.yaml.old.$$"
unit_dir=$(dirname "$UNIT_PATH")
unit_candidate="$unit_dir/.miobridge-agent.service.new.$$"
unit_backup="$unit_dir/.miobridge-agent.service.old.$$"
old_active=0
had_binary=0
had_config=0
had_unit=0

rollback() {
  [ "$MUTATED" -eq 1 ] || return 0
  systemctl_user stop miobridge-agent >/dev/null 2>&1 || true
  rm -f "$binary" "$config_candidate" "$unit_candidate"
  [ "$REPLACE_CONFIG" -eq 0 ] || rm -f "$config"
  rm -f "$UNIT_PATH"
  [ ! -e "$binary_backup" ] || mv "$binary_backup" "$binary"
  [ ! -e "$config_backup" ] || mv "$config_backup" "$config"
  [ ! -e "$unit_backup" ] || mv "$unit_backup" "$UNIT_PATH"
  systemctl_user daemon-reload >/dev/null 2>&1 || true
  if [ "$had_unit" -eq 1 ] && [ "$old_active" -eq 1 ]; then
    systemctl_user restart miobridge-agent >/dev/null 2>&1 || true
  elif [ "$had_unit" -eq 0 ]; then
    systemctl_user disable miobridge-agent >/dev/null 2>&1 || true
  fi
  MUTATED=0
}

cleanup() {
  rollback
  rm -rf "$tmp"
  rm -f "$binary_candidate" "$config_candidate" "$unit_candidate"
}
trap cleanup 0
trap 'exit 130' HUP INT TERM

download "$BASE_URL/$artifact" "$tmp/$artifact"
download "$BASE_URL/SHA256SUMS" "$tmp/SHA256SUMS"
expected="$(awk -v name="$artifact" '$2 == name || $2 == "*" name { print $1; exit }' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || { echo "checksum entry missing for $artifact" >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$tmp/$artifact" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then actual="$(shasum -a 256 "$tmp/$artifact" | awk '{print $1}')"
else echo "sha256sum or shasum is required to verify MioBridge Agent" >&2; exit 1
fi
[ "$actual" = "$expected" ] || { echo "checksum verification failed for $artifact" >&2; exit 1; }

gzip -dc "$tmp/$artifact" > "$tmp/miobridge-agent"
chmod 0755 "$tmp/miobridge-agent"
reported_version="$("$tmp/miobridge-agent" --version)" || { echo "downloaded Agent failed --version" >&2; exit 1; }
case "$reported_version" in "$VERSION"|"v$VERSION") ;; *) echo "Agent version mismatch: expected $VERSION, got $reported_version" >&2; exit 1 ;; esac

yaml_quote() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

manual_config=0
[ -n "$NODE_ID$NODE_NAME$SECRET_FILE$KERNEL_ARGUMENTS" ] && manual_config=1
[ "$PORT_SET" -eq 0 ] || manual_config=1
[ -z "$CONFIG_SOURCE" ] || [ "$manual_config" -eq 0 ] || { echo "--config cannot be combined with independent configuration options" >&2; exit 2; }

if [ -n "$CONFIG_SOURCE" ]; then
  [ -f "$CONFIG_SOURCE" ] || { echo "Agent config does not exist: $CONFIG_SOURCE" >&2; exit 2; }
  cp "$CONFIG_SOURCE" "$tmp/agent.yaml"
  REPLACE_CONFIG=1
elif [ "$manual_config" -eq 1 ]; then
  [ -n "$NODE_ID" ] && [ -n "$NODE_NAME" ] && [ -n "$SECRET_FILE" ] \
    || { echo "--node-id, --node-name, and --secret-file are required together" >&2; exit 2; }
  [ -f "$SECRET_FILE" ] || { echo "secret file does not exist: $SECRET_FILE" >&2; exit 2; }
  secret="$(awk 'NR == 1 { printf "%s", $0 } NR > 1 { exit 2 }' "$SECRET_FILE")" \
    || { echo "secret file must contain exactly one line" >&2; exit 2; }
  [ -n "$secret" ] || { echo "secret file is empty" >&2; exit 2; }
  {
    printf 'node:\n'
    printf '  id: "%s"\n' "$(yaml_quote "$NODE_ID")"
    printf '  name: "%s"\n' "$(yaml_quote "$NODE_NAME")"
    printf '  secret: "%s"\n' "$(yaml_quote "$secret")"
    if [ -z "$KERNEL_ARGUMENTS" ]; then
      printf 'kernels: []\n'
    else
      printf 'kernels:\n'
      printf '%s\n' "$KERNEL_ARGUMENTS" | while IFS= read -r kernel; do
        case "$kernel" in *:*) ;; *) echo "invalid --kernel value: $kernel" >&2; exit 2 ;; esac
        kernel_type=${kernel%%:*}
        kernel_path=${kernel#*:}
        case "$kernel_type" in sing-box|xray|v2ray) ;; *) echo "unsupported kernel type: $kernel_type" >&2; exit 2 ;; esac
        [ -n "$kernel_path" ] || { echo "kernel config path is required: $kernel_type" >&2; exit 2; }
        printf '  - type: "%s"\n' "$kernel_type"
        printf '    configPath: "%s"\n' "$(yaml_quote "$kernel_path")"
      done
    fi
    printf 'mihomo:\n  path: "mihomo"\n'
    printf 'port: %s\n' "$PORT"
  } > "$tmp/agent.yaml"
  REPLACE_CONFIG=1
elif [ -f "$config" ]; then
  cp "$config" "$tmp/agent.yaml"
else
  echo "first Agent installation requires --config or independent node parameters" >&2
  exit 2
fi

"$tmp/miobridge-agent" --check-config "$tmp/agent.yaml" >/dev/null
health_port="$(awk -F: '/^port:[[:space:]]*/ { value=$2; gsub(/[[:space:]"'\'' ]/, "", value); print value; exit }' "$tmp/agent.yaml")"
[ -n "$health_port" ] || health_port=3001

mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$unit_dir"
cp "$tmp/miobridge-agent" "$binary_candidate"
cp "$tmp/agent.yaml" "$config_candidate"
chmod 0755 "$binary_candidate"
chmod 0600 "$config_candidate"
escaped_binary=$(yaml_quote "$binary")
escaped_config=$(yaml_quote "$config")
escaped_config_dir=$(yaml_quote "$CONFIG_DIR")
cat > "$unit_candidate" <<EOF
[Unit]
Description=MioBridge Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart="$escaped_binary" --config "$escaped_config"
WorkingDirectory="$escaped_config_dir"
Environment="PATH=%h/.config/miobridge/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin"
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF
chmod 0644 "$unit_candidate"

systemctl_user is-active --quiet miobridge-agent >/dev/null 2>&1 && old_active=1 || true
[ ! -e "$binary" ] || had_binary=1
[ ! -e "$config" ] || had_config=1
[ ! -e "$UNIT_PATH" ] || had_unit=1

replace_files() {
  [ "$had_binary" -eq 0 ] || cp "$binary" "$binary_backup" || return 1
  if [ "$REPLACE_CONFIG" -eq 1 ]; then
    [ "$had_config" -eq 0 ] || cp "$config" "$config_backup" || return 1
  fi
  [ "$had_unit" -eq 0 ] || cp "$UNIT_PATH" "$unit_backup" || return 1
  MUTATED=1
  mv "$binary_candidate" "$binary" || return 1
  if [ "$REPLACE_CONFIG" -eq 1 ]; then
    mv "$config_candidate" "$config" || return 1
  fi
  mv "$unit_candidate" "$UNIT_PATH" || return 1
}

if ! replace_files; then
  rollback
  echo "Agent installation failed while replacing files; previous files restored" >&2
  exit 1
fi

if ! systemctl_user daemon-reload \
  || ! systemctl_user enable miobridge-agent \
  || ! systemctl_user restart miobridge-agent \
  || ! systemctl_user is-active --quiet miobridge-agent; then
  rollback
  echo "Agent systemd activation failed; previous files restored" >&2
  exit 1
fi

health_ok=0
attempt=1
while [ "$attempt" -le 20 ]; do
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:$health_port/health" >/dev/null 2>&1 && health_ok=1 || true
  else
    wget -qO- "http://127.0.0.1:$health_port/health" >/dev/null 2>&1 && health_ok=1 || true
  fi
  [ "$health_ok" -eq 0 ] || break
  sleep 1
  attempt=$((attempt + 1))
done
if [ "$health_ok" -eq 0 ]; then
  rollback
  echo "Agent health check failed; previous files restored" >&2
  exit 1
fi

rm -f "$binary_backup" "$config_backup" "$unit_backup" "$config_candidate"
MUTATED=0
echo "MioBridge Agent $VERSION installed at $binary"
echo "Agent config: $config"
echo "user systemd service: miobridge-agent (active)"
