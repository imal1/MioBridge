import type { DeploymentConnection, DeployOptions, SshTarget } from './types.js';
import type { SshTransport } from './transport.js';
import { shellQuote, userSystemctl } from './util.js';

export const AGENT_SYSTEM_UNIT = '/etc/systemd/system/miobridge-agent.service';
export const AGENT_SERVICE_RECEIPT = '/etc/miobridge-agent/miobridge-service.json';
export interface AgentServiceRuntime {
  readonly mode: 'user' | 'system';
  readonly user: string;
  readonly home: string;
  readonly binaryPath: string;
  readonly configPath: string;
  readonly unitPath: string;
  readonly managed: boolean;
  readonly sourceUser?: string;
  readonly sourceHome?: string;
}
export function validRuntimeUser(user: string): boolean { return /^[a-z_][a-z0-9_-]*[$]?$/i.test(user) && user !== 'root'; }
function validHome(home: string): boolean { return /^\/[a-zA-Z0-9_./-]+$/.test(home) && !home.split('/').some(part => part === '..' || part === '.'); }
export function systemAgentRuntime(user: string, home: string): AgentServiceRuntime {
  if (!validRuntimeUser(user) || !validHome(home)) throw new Error('系统服务运行用户或 home 路径无效');
  return { mode: 'system', user, home, binaryPath: `${home}/.config/miobridge/bin/miobridge-agent`, configPath: `${home}/.config/miobridge/agent/agent.yaml`, unitPath: AGENT_SYSTEM_UNIT, managed: true };
}
export function systemAgentUnit(runtime: AgentServiceRuntime, candidate = false): string {
  if (!validRuntimeUser(runtime.user) || !validHome(runtime.home)) throw new Error('系统服务运行用户或 home 路径无效');
  return `[Unit]\nDescription=MioBridge Agent${candidate ? ' migration candidate' : ''}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=${runtime.user}\nExecStart=${runtime.binaryPath} --config ${runtime.configPath}${candidate ? '.candidate' : ''}\nWorkingDirectory=${runtime.home}/.config/miobridge/agent\nEnvironment=HOME=${runtime.home}\nEnvironment=PATH=${runtime.home}/.config/miobridge/bin:${runtime.home}/.local/bin:/usr/local/bin:/usr/bin:/bin\n${candidate ? 'Environment=MIOBRIDGE_AGENT_HOST=127.0.0.1\nIPAddressDeny=any\nIPAddressAllow=localhost\n' : ''}Restart=always\nRestartSec=5\nNoNewPrivileges=true\nPrivateTmp=true\n\n[Install]\nWantedBy=multi-user.target\n`;
}
export async function readSystemAgentRuntime(transport: SshTransport, ssh: DeploymentConnection): Promise<AgentServiceRuntime | undefined> {
  const receipt = await transport.exec(ssh, `if test -f ${shellQuote(AGENT_SERVICE_RECEIPT)}; then test -s ${shellQuote(AGENT_SERVICE_RECEIPT)} || exit 65; cat ${shellQuote(AGENT_SERVICE_RECEIPT)}; fi`);
  if (receipt.code !== 0) throw new Error('无法读取 Agent 服务模式记录，请检查文件权限');
  if (receipt.stdout.trim()) {
    let value: Partial<AgentServiceRuntime>;
    try { value = JSON.parse(receipt.stdout) as Partial<AgentServiceRuntime>; } catch { throw new Error('Agent 服务模式记录损坏，请管理员检查'); }
    if (value.mode !== 'system' || !value.user || !validRuntimeUser(value.user) || !value.home || !validHome(value.home)
      || value.binaryPath !== `${value.home}/.config/miobridge/bin/miobridge-agent` || value.configPath !== `${value.home}/.config/miobridge/agent/agent.yaml` || value.unitPath !== AGENT_SYSTEM_UNIT) throw new Error('Agent 服务模式记录包含无效路径或用户');
    if ((value.sourceHome || value.sourceUser) && (!value.sourceHome || !validHome(value.sourceHome) || !value.sourceUser || !/^[a-z_][a-z0-9_-]*[$]?$/i.test(value.sourceUser))) throw new Error('Agent 原用户服务记录无效');
    return { ...systemAgentRuntime(value.user, value.home), ...(value.sourceHome && value.sourceUser ? { sourceHome: value.sourceHome, sourceUser: value.sourceUser } : {}) };
  }
  return undefined;
}
export async function detectAgentService(transport: SshTransport, ssh: DeploymentConnection): Promise<AgentServiceRuntime> {
  const system = await readSystemAgentRuntime(transport, ssh);
  if (system) return system;
  const user = await transport.exec(ssh, 'id -un');
  const home = await transport.exec(ssh, 'printf %s "$HOME"');
  if (user.code !== 0 || !user.stdout.trim() || home.code !== 0 || !home.stdout.startsWith('/')) throw new Error('无法确定 Agent 运行用户和 home 路径');
  return { mode: 'user', user: user.stdout.trim(), home: home.stdout.trim(), binaryPath: `${home.stdout.trim()}/.local/bin/miobridge-agent`, configPath: `${home.stdout.trim()}/.config/miobridge-agent/agent.yaml`, unitPath: `${home.stdout.trim()}/.config/systemd/user/miobridge-agent.service`, managed: false };
}
export async function agentServiceAction(transport: SshTransport, ssh: DeploymentConnection, target: SshTarget, action: 'start' | 'stop' | 'restart' | 'uninstall', options: DeployOptions): Promise<boolean> {
  // A receipt, not a binary's existence, selects a migrated service's manager.
  const runtime = await readSystemAgentRuntime(transport, ssh);
  if (!runtime) return false;
  const command = action === 'uninstall' ? [
    'set -e', 'systemctl disable --now miobridge-agent.service',
    `rm -f ${shellQuote(runtime.unitPath)} ${shellQuote(runtime.binaryPath)} ${shellQuote(AGENT_SERVICE_RECEIPT)}`,
    ...(options.preserveConfig ? [] : [`rm -f ${shellQuote(runtime.configPath)} ${shellQuote(`${runtime.configPath}.candidate`)}`]),
    ...(options.preserveData ? [] : [`rm -rf ${shellQuote(`${runtime.home}/.config/miobridge/agent/data`)}`]),
    ...(runtime.sourceHome && runtime.sourceUser ? [
      `runuser -u ${shellQuote(runtime.sourceUser)} -- env XDG_RUNTIME_DIR="/run/user/$(id -u ${shellQuote(runtime.sourceUser)})" systemctl --user disable --now miobridge-agent.service 2>/dev/null || true`,
      `rm -f ${shellQuote(`${runtime.sourceHome}/.local/bin/miobridge-agent`)} ${shellQuote(`${runtime.sourceHome}/.config/systemd/user/miobridge-agent.service`)}`,
      ...(options.preserveConfig ? [] : [`rm -rf ${shellQuote(`${runtime.sourceHome}/.config/miobridge-agent`)}`]),
      ...(options.preserveData ? [] : [`rm -rf ${shellQuote(`${runtime.sourceHome}/.local/share/miobridge-agent`)}`]),
    ] : []),
    'systemctl daemon-reload',
  ].join('\n') : `systemctl ${action} miobridge-agent.service`;
  const result = await transport.execRoot(ssh, target, command);
  if (result.code !== 0) throw new Error(`系统级 Agent ${action} 失败: ${(result.stderr || result.stdout).trim()}`);
  return true;
}
export function runtimeSystemctl(runtime: AgentServiceRuntime, ...args: string[]): string {
  return runtime.mode === 'system' ? ['systemctl', ...args].map(shellQuote).join(' ') : userSystemctl(...args);
}
