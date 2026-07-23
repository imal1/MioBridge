/**
 * Stateless mihomo detection/install/uninstall over an established connection.
 * Install pins the artifact by sha256 and installs atomically into the user's
 * home; uninstall removes both the user-space and any legacy system binary.
 */
import { PINNED_ARTIFACTS } from '../../../setup/catalog.js';
import { shellQuote } from './util.js';
import { MIHOMO_USER_PATH, type DeploymentConnection, type MihomoDetection, type SshTarget } from './types.js';
import type { SshTransport } from './transport.js';

export async function detectMihomoOn(transport: SshTransport, ssh: DeploymentConnection): Promise<MihomoDetection> {
  try {
    const result = await transport.exec(ssh, 'for candidate in "$HOME/.config/miobridge/bin/mihomo" "$HOME/.local/bin/mihomo" /usr/local/bin/mihomo; do if [ -x "$candidate" ]; then printf "%s\\n" "$candidate"; "$candidate" -v 2>&1; exit $?; fi; done; exit 127');
    const output = (result.stdout || result.stderr).trim();
    const [path, ...versionLines] = output.split(/\r?\n/);
    const version = versionLines.find(line => line.trim())?.trim();
    return result.code === 0
      ? { installed: true, path: path || MIHOMO_USER_PATH, ...(version ? { version } : {}) }
      : { installed: false, path: MIHOMO_USER_PATH, ...(output ? { error: output } : {}) };
  } catch (error) {
    return { installed: false, path: MIHOMO_USER_PATH, error: error instanceof Error ? error.message : '检测失败' };
  }
}

export async function installMihomoOn(transport: SshTransport, ssh: DeploymentConnection): Promise<MihomoDetection> {
  const machine = await transport.exec(ssh, 'uname -m');
  if (machine.code !== 0) throw new Error('无法识别远端架构');
  const architecture = /^(x86_64|amd64)$/.test(machine.stdout.trim())
    ? 'x64'
    : /^(aarch64|arm64)$/.test(machine.stdout.trim()) ? 'arm64' : null;
  if (!architecture) throw new Error(`不支持的 mihomo 架构: ${machine.stdout.trim()}`);
  const artifact = PINNED_ARTIFACTS.mihomo[architecture];
  const script = [
    'set -e',
    'workdir=$(mktemp -d /tmp/miobridge-mihomo-install.XXXXXX)',
    `trap 'rm -rf "$workdir"' EXIT`,
    'command -v sha256sum >/dev/null && command -v gzip >/dev/null',
    'if command -v curl >/dev/null; then curl -fsSL --retry 3 "$URL" -o "$workdir/mihomo.gz"; elif command -v wget >/dev/null; then wget -qO "$workdir/mihomo.gz" "$URL"; else exit 127; fi',
    'printf "%s  %s\\n" "$SHA256" "$workdir/mihomo.gz" | sha256sum -c -',
    'gzip -dc "$workdir/mihomo.gz" > "$workdir/mihomo"',
    'chmod 755 "$workdir/mihomo"',
    `"$workdir/mihomo" -v | grep -F ${shellQuote(artifact.version.replace(/^v/, ''))} >/dev/null`,
    'mkdir -p "$HOME/.config/miobridge/bin"',
    `install -m 755 "$workdir/mihomo" \"${MIHOMO_USER_PATH}\"`,
  ].join('\n');
  const command = `URL=${shellQuote(artifact.url)} SHA256=${shellQuote(artifact.sha256)} bash -c ${shellQuote(script)}`;
  const installed = await transport.exec(ssh, command);
  if (installed.code !== 0) throw new Error(`mihomo 安装失败: ${(installed.stderr || installed.stdout).trim().slice(-600)}`);
  return await detectMihomoOn(transport, ssh);
}

export async function uninstallMihomoOn(transport: SshTransport, ssh: DeploymentConnection, target: SshTarget): Promise<MihomoDetection> {
  const detected = await detectMihomoOn(transport, ssh);
  const removed = detected.installed && detected.path === '/usr/local/bin/mihomo'
    ? await transport.execRoot(ssh, target, 'rm -f /usr/local/bin/mihomo')
    : await transport.exec(ssh, `rm -f \"${MIHOMO_USER_PATH}\" "$HOME/.local/bin/mihomo"`);
  if (removed.code !== 0) throw new Error((removed.stderr || removed.stdout).trim() || 'mihomo 卸载失败');
  return await detectMihomoOn(transport, ssh);
}
