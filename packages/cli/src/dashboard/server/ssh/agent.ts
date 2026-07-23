/**
 * Stateless user-space Agent mechanics over an established connection:
 * download+verify+install the release binary, write the config/unit files
 * atomically, (re)start the user service, verify health, and render the
 * agent.yaml / systemd unit. No target resolution or persistence here.
 */
import { Buffer } from 'node:buffer';
import type { NodeKernelConfig } from '@miobridge/core';
import { CLI_VERSION } from '../../../command.js';
import { agentRelease, shellQuote, userSystemctl } from './util.js';
import {
  DEFAULT_CONFIG_PATHS,
  LEGACY_AGENT_CONFIG_PATH,
  LEGACY_AGENT_PATH,
  LEGACY_AGENT_SERVICE_PATH,
  type DeploymentConnection,
  type SshTarget,
} from './types.js';
import type { SshTransport } from './transport.js';

export function agentYaml(target: SshTarget, kernels: readonly NodeKernelConfig[]): string {
  const kernelYaml = kernels.map(kernel => [
    `  - type: ${JSON.stringify(kernel.type)}`,
    `    configPath: ${JSON.stringify(kernel.configPath ?? DEFAULT_CONFIG_PATHS[kernel.type])}`,
  ].join('\n')).join('\n');
  const kernelsBlock = kernelYaml ? `kernels:\n${kernelYaml}` : 'kernels: []';
  return `node:\n  id: ${JSON.stringify(target.nodeId)}\n  name: ${JSON.stringify(target.nodeName)}\n  secret: ${JSON.stringify(target.secret)}\n${kernelsBlock}\nmihomo:\n  path: "mihomo"\nport: ${target.agentPort}\n`;
}

export function systemdUnit(): string {
  return `[Unit]\nDescription=MioBridge Agent\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=%h/.local/bin/miobridge-agent --config %h/.config/miobridge-agent/agent.yaml\nWorkingDirectory=%h/.config/miobridge-agent\nEnvironment=PATH=%h/.config/miobridge/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin\nRestart=always\nRestartSec=5\nNoNewPrivileges=true\nPrivateTmp=true\n\n[Install]\nWantedBy=default.target\n`;
}

async function writeUserFile(transport: SshTransport, ssh: DeploymentConnection, relative: string, content: string, mode: number, kind: 'config' | 'unit'): Promise<void> {
  const encoded = Buffer.from(content).toString('base64');
  const script = [
    'set -e',
    kind === 'config'
      ? `target="$HOME/.config/${relative}"`
      : `target="$HOME/.config/systemd/user/${relative}"`,
    'mkdir -p "$(dirname "$target")"',
    'tmp=$(mktemp "$(dirname "$target")/.miobridge.tmp.XXXXXX")',
    `trap 'rm -f -- "$tmp"' EXIT`,
    `printf %s ${shellQuote(encoded)} | base64 -d > "$tmp"`,
    `chmod ${mode.toString(8)} "$tmp"`,
    'mv -- "$tmp" "$target"',
    'trap - EXIT',
  ].join('\n');
  const written = await transport.exec(ssh, `bash -c ${shellQuote(script)}`);
  if (written.code !== 0) throw new Error(`写入用户态 Agent 文件失败: ${(written.stderr || written.stdout).trim()}`);
}

export async function installAgent(transport: SshTransport, ssh: DeploymentConnection, target: SshTarget, kernels: readonly NodeKernelConfig[]): Promise<void> {
  const detected = await transport.exec(ssh, 'uname -m');
  if (detected.code !== 0) throw new Error(`Agent 架构检测失败: ${(detected.stderr || detected.stdout).trim()}`);
  const machine = detected.stdout.trim();
  const architecture = /^(x86_64|amd64)$/.test(machine)
    ? 'x64'
    : /^(aarch64|arm64)$/.test(machine) ? 'arm64' : null;
  if (!architecture) throw new Error(`不支持的 Agent 架构: ${machine}`);
  const version = CLI_VERSION;
  const release = agentRelease(version, architecture);
  const installScript = [
    'set -e',
    'workdir=$(mktemp -d /tmp/miobridge-agent-install.XXXXXX)',
    `trap 'rm -rf "$workdir"' EXIT`,
    'command -v sha256sum >/dev/null && command -v gzip >/dev/null',
    'if command -v curl >/dev/null; then download() { curl -fsSL --retry 3 "$1" -o "$2"; }; elif command -v wget >/dev/null; then download() { wget -qO "$2" "$1"; }; else exit 127; fi',
    `download ${shellQuote(`${release.baseUrl}/${release.artifact}`)} "$workdir/agent.gz"`,
    `download ${shellQuote(`${release.baseUrl}/SHA256SUMS`)} "$workdir/SHA256SUMS"`,
    `expected=$(awk -v name=${shellQuote(release.artifact)} '$2 == name || $2 == "*" name { print $1; exit }' "$workdir/SHA256SUMS")`,
    '[ -n "$expected" ]',
    'actual=$(sha256sum "$workdir/agent.gz" | awk \'{print $1}\')',
    '[ "$actual" = "$expected" ]',
    'gzip -dc "$workdir/agent.gz" > "$workdir/agent"',
    `test "$(chmod 755 "$workdir/agent" && "$workdir/agent" --version)" = ${shellQuote(version)}`,
    'mkdir -p "$HOME/.local/bin" "$HOME/.config/miobridge-agent" "$HOME/.config/systemd/user"',
    'install -m 755 "$workdir/agent" "$HOME/.local/bin/miobridge-agent"',
  ].join('\n');
  const installed = await transport.exec(ssh, `bash -c ${shellQuote(installScript)}`);
  if (installed.code !== 0) throw new Error(`Agent 安装或校验失败: ${(installed.stderr || installed.stdout).trim().slice(-600)}`);
  await writeUserFile(transport, ssh, 'miobridge-agent/agent.yaml', agentYaml(target, kernels), 0o600, 'config');
  await writeUserFile(transport, ssh, 'miobridge-agent.service', systemdUnit(), 0o644, 'unit');
}

export async function startAgent(transport: SshTransport, ssh: DeploymentConnection): Promise<void> {
  const legacy = await transport.exec(ssh, `test -x ${shellQuote(LEGACY_AGENT_PATH)} || test -f ${shellQuote(LEGACY_AGENT_SERVICE_PATH)} || test -f ${shellQuote(LEGACY_AGENT_CONFIG_PATH)}`);
  if (legacy.code === 0) throw new Error('检测到旧版系统级 Agent。请先由管理员执行 "sudo systemctl disable --now miobridge-agent" 并删除旧 unit，之后重试用户态部署。');
  const started = await transport.exec(ssh, `${userSystemctl('daemon-reload')} && ${userSystemctl('enable', '--now', 'miobridge-agent.service')} && ${userSystemctl('restart', 'miobridge-agent.service')}`);
  if (started.code !== 0) throw new Error(`Agent 启动失败: ${(started.stderr || started.stdout).trim()}`);
}

export async function verifyAgent(transport: SshTransport, ssh: DeploymentConnection, target: SshTarget): Promise<void> {
  const checked = await transport.exec(ssh, `for i in 1 2 3 4 5; do code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${target.agentPort}/health || true); [ "$code" = 200 ] && exit 0; sleep 2; done; exit 1`);
  if (checked.code !== 0) throw new Error('Agent 健康检查失败');
}

export async function replaceAgentConfig(transport: SshTransport, ssh: DeploymentConnection, content: string): Promise<boolean> {
  const encoded = Buffer.from(content).toString('base64');
  const script = [
    'set -e',
    'config="$HOME/.config/miobridge-agent/agent.yaml"',
    'rollback="$config.rollback"',
    'mkdir -p "$(dirname "$config")"',
    'tmp=$(mktemp "$HOME/.config/miobridge-agent/.agent.yaml.tmp.XXXXXX")',
    `trap 'rm -f -- "$tmp"' EXIT`,
    `printf %s ${shellQuote(encoded)} | base64 -d > "$tmp"`,
    'chmod 600 "$tmp"',
    '"$HOME/.local/bin/miobridge-agent" --check-config "$tmp"',
    'if [ -f "$config" ]; then cp "$config" "$rollback"; else rm -f "$rollback"; fi',
    'mv "$tmp" "$config"',
    'trap - EXIT',
  ].join('\n');
  const result = await transport.exec(ssh, `bash -c ${shellQuote(script)}`);
  if (result.code !== 0) throw new Error(`Agent 配置校验或原子替换失败: ${(result.stderr || result.stdout).trim()}`);
  return true;
}
