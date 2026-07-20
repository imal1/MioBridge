import { Buffer } from 'node:buffer';
import { CLI_VERSION } from '../../command.js';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { createConnection, isIP } from 'node:net';
import {
  KERNEL_TYPES,
  validateNodeKernels,
  type KernelType,
  type NodeConfig,
  type NodeKernelConfig,
} from '@miobridge/core';
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import type { NodeCoreComposition } from '../../composition.js';
import { PINNED_ARTIFACTS } from '../../setup/catalog.js';
import {
  KERNEL_SCRIPTS,
  installCommand,
  repairCommand,
  reinstallCommand,
  uninstallCommand,
  upgradeCommand,
  wrapperCommand,
} from './kernelScripts.js';

const AGENT_USER_BIN = '$HOME/.local/bin/miobridge-agent';
const AGENT_USER_CONFIG = '$HOME/.config/miobridge-agent/agent.yaml';
const AGENT_USER_UNIT = '$HOME/.config/systemd/user/miobridge-agent.service';
const LEGACY_AGENT_PATH = '/usr/local/bin/miobridge-agent';
const LEGACY_AGENT_CONFIG_PATH = '/etc/miobridge-agent/agent.yaml';
const LEGACY_AGENT_SERVICE_PATH = '/etc/systemd/system/miobridge-agent.service';
const MIHOMO_USER_PATH = '$HOME/.config/miobridge/bin/mihomo';
const PROGRESS_TTL_MS = 10 * 60 * 1000;
const TASK_HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULT_CONFIG_PATHS: Record<KernelType, string> = {
  'sing-box': '/etc/sing-box/config.json',
  xray: '/etc/xray/config.json',
  v2ray: '/etc/v2ray/config.json',
};

export interface KernelDetection {
  readonly type: KernelType;
  readonly installed: boolean;
  readonly version?: string;
  readonly defaultConfigPath: string;
  /** 检测时以 test -x 实际验证过可执行的管理脚本路径；未安装时不返回。 */
  readonly binaryPath?: string;
  readonly error?: string;
}

export interface MihomoDetection {
  readonly installed: boolean;
  readonly version?: string;
  readonly path: string;
  readonly error?: string;
}

export interface DeployStatus {
  readonly nodeId: string;
  readonly deploymentId: string;
  readonly step: 'connect' | 'kernel' | 'agent' | 'start' | 'verify' | 'done';
  readonly status: 'pending' | 'running' | 'success' | 'error';
  readonly message: string;
  readonly progress: number;
  readonly startedAt: number;
}

export type DeployComponent = 'agent' | 'mihomo' | KernelType;
export type DeployOperation = 'install' | 'reinstall' | 'upgrade' | 'repair' | 'uninstall';
export interface DeployOptions { readonly preserveConfig: boolean; readonly preserveData: boolean }

export interface DeploymentEvent {
  readonly eventId: string;
  readonly taskId: string;
  readonly nodeId: string;
  readonly component: DeployComponent;
  readonly step: ComponentDeployStatus['step'];
  readonly status: ComponentDeployStatus['status'];
  readonly progress: number;
  readonly message: string;
  readonly timestamp: string;
}

export interface ComponentDeployStatus {
  readonly taskId: string;
  readonly idempotencyKey: string;
  readonly nodeId: string;
  readonly component: DeployComponent;
  readonly operation: DeployOperation;
  readonly step: 'queued' | 'prechecking' | 'downloading' | 'verifying_package' | 'installing' | 'configuring' | 'restarting' | 'postchecking' | 'done';
  readonly status: 'pending' | 'running' | 'success' | 'error' | 'cancelled';
  readonly message: string;
  readonly progress: number;
  readonly actorRole: 'admin' | 'operator' | 'viewer';
  readonly options: DeployOptions;
  readonly createdAt: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly beforeVersion?: string;
  readonly afterVersion?: string;
  readonly retryOf?: string;
  readonly errorCode?: string;
}

interface SshTarget {
  readonly local?: boolean;
  readonly nodeId: string;
  readonly nodeName: string;
  readonly secret: string;
  readonly agentPort: number;
  readonly kernels: readonly NodeKernelConfig[];
  readonly ssh: {
    readonly host: string;
    readonly user: string;
    readonly port: number;
    readonly authMethod: 'password' | 'privateKey';
    readonly password?: string;
    readonly privateKey?: string;
    hostKey: string;
  };
}

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

interface DeploymentConnection {
  run(command: string, input?: string): Promise<ExecResult>;
  end(): void;
}

export interface DeploymentServiceOptions {
  readonly runLocal?: (command: string, input?: string) => Promise<ExecResult>;
}

function inputObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求内容无效');
  return value as Record<string, unknown>;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function userSystemctl(...args: readonly string[]): string {
  const command = ['systemctl', '--user', ...args].map(shellQuote).join(' ');
  return `XDG_RUNTIME_DIR=\"\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}\" ${command}`;
}

function validatePrivateKey(value: string): void {
  if (Buffer.byteLength(value, 'utf8') > 64 * 1024) throw new Error('SSH 私钥不能超过 64 KiB');
  const trimmed = value.trim();
  if (!trimmed.includes('PRIVATE KEY-----')) throw new Error('无效的 SSH 私钥');
  if (trimmed.includes('ENCRYPTED PRIVATE KEY') || /Proc-Type:\s*4,ENCRYPTED|DEK-Info:/i.test(trimmed)) {
    throw new Error('暂不支持带口令的 SSH 私钥');
  }
}

export function agentRelease(
  version: string,
  architecture: 'x64' | 'arm64',
  env: NodeJS.ProcessEnv = process.env,
): { artifact: string; baseUrl: string } {
  const repository = env.MIOBRIDGE_REPOSITORY ?? 'imal1/MioBridge';
  return {
    artifact: `miobridge-agent-${version}-linux-${architecture}.gz`,
    baseUrl: env.MIOBRIDGE_RELEASE_BASE_URL ?? `https://github.com/${repository}/releases/download/v${version}`,
  };
}

export class SshDeploymentService {
  readonly #progress = new Map<string, DeployStatus>();
  readonly #componentProgress = new Map<string, ComponentDeployStatus>();
  readonly #eventCounters = new Map<string, number>();
  readonly #resumedTasks = new Set<string>();

  constructor(
    private readonly composition: NodeCoreComposition,
    private readonly options: DeploymentServiceOptions = {},
  ) {}

  async preflight(body: unknown): Promise<{
    hostKey: string;
    architecture: string;
    checks: Array<{ key: string; label: string; ok: boolean; detail: string }>;
  }> {
    const input = inputObject(body);
    const component = typeof input.component === 'string' ? this.deployComponent(input.component) : 'agent';
    const target = typeof input.nodeId === 'string'
      ? await this.targetForNode(input.nodeId)
      : await this.targetFromSsh(inputObject(input.ssh));
    const network = target.local
      ? { dns: { ok: true, detail: '本机直接执行' }, tcp: { ok: true, detail: '无需 SSH' } }
      : await networkPreflight(target.ssh.host, target.ssh.port);
    if (!network.dns.ok || !network.tcp.ok) {
      const skipped = (key: string, label: string) => ({ key, label, ok: false, detail: '网络预检未通过，未执行' });
      return {
        hostKey: target.ssh.hostKey,
        architecture: '',
        checks: [
          { key: 'dns', label: 'DNS 解析', ok: network.dns.ok, detail: network.dns.detail },
          { key: 'tcp', label: 'TCP 连接', ok: network.tcp.ok, detail: network.tcp.detail },
          skipped('ssh', 'SSH 认证'), skipped('system', 'Linux 系统'), skipped('architecture', 'CPU 架构'),
          skipped('disk', '磁盘空间'), skipped('systemd', 'systemd'), skipped('download', '下载工具'),
          skipped('privilege', '管理员权限'),
        ],
      };
    }
    const ssh = await this.connect(target);
    try {
      const needsUserSystemd = component === 'agent';
      const needsSystemd = component !== 'mihomo';
      const [system, architecture, disk, systemd, downloader, privilege] = await Promise.all([
        this.exec(ssh, 'uname -s'),
        this.exec(ssh, 'uname -m'),
        this.exec(ssh, "df -Pk / | awk 'NR==2 {print $4}'"),
        !needsSystemd
          ? Promise.resolve({ stdout: '', stderr: '', code: 0 })
          : needsUserSystemd
          ? this.exec(ssh, userSystemctl('show-environment'))
          : this.exec(ssh, 'command -v systemctl'),
        this.exec(ssh, 'command -v curl || command -v wget'),
        Promise.resolve({ stdout: '', stderr: '', code: 0 }),
      ]);
      const freeKb = Number(disk.stdout.trim());
      const checks = [
        { key: 'dns', label: 'DNS 解析', ok: network.dns.ok, detail: network.dns.detail },
        { key: 'tcp', label: 'TCP 连接', ok: network.tcp.ok, detail: network.tcp.detail },
        { key: 'ssh', label: target.local ? '本机执行' : 'SSH 认证', ok: true, detail: target.local ? '直接调用本机命令' : '连接与认证成功' },
        { key: 'system', label: 'Linux 系统', ok: system.code === 0 && system.stdout.trim() === 'Linux', detail: system.stdout.trim() || system.stderr.trim() },
        { key: 'architecture', label: 'CPU 架构', ok: /^(x86_64|amd64|aarch64|arm64)$/.test(architecture.stdout.trim()), detail: architecture.stdout.trim() || architecture.stderr.trim() },
        { key: 'disk', label: '磁盘空间', ok: Number.isFinite(freeKb) && freeKb >= 200 * 1024, detail: Number.isFinite(freeKb) ? `${Math.round(freeKb / 1024)} MiB 可用` : '无法读取' },
        { key: 'systemd', label: needsUserSystemd ? '用户级 systemd' : 'systemd', ok: systemd.code === 0, detail: !needsSystemd ? 'mihomo 用户态安装不需要 systemd' : systemd.code === 0 ? (needsUserSystemd ? 'systemctl --user 可用' : systemd.stdout.trim()) : (systemd.stderr || systemd.stdout).trim() || '未找到' },
        { key: 'download', label: '下载工具', ok: downloader.code === 0, detail: downloader.stdout.trim() || '未找到 curl/wget' },
        { key: 'privilege', label: '执行权限', ok: privilege.code === 0, detail: KERNEL_TYPES.includes(component as KernelType) ? '优先直接执行 233boy 脚本；仅在明确权限不足时自动提权' : '此组件使用用户态部署，无需 sudo' },
      ];
      return { hostKey: target.ssh.hostKey, architecture: architecture.stdout.trim(), checks };
    } finally { ssh.end(); }
  }

  async detect(body: unknown): Promise<KernelDetection[]> {
    const input = inputObject(body);
    const target = typeof input.nodeId === 'string'
      ? await this.targetForNode(input.nodeId)
      : await this.targetFromSsh(inputObject(input.ssh));
    const ssh = await this.connect(target);
    try {
      return await Promise.all(KERNEL_TYPES.map(type => this.detectKernel(ssh, type)));
    } finally {
      ssh.end();
    }
  }

  async startDeployment(nodeId: string, kernels?: unknown): Promise<{ deploymentId: string }> {
    const node = await this.findNode(nodeId);
    const requested = validateNodeKernels(kernels === undefined ? node.kernels : kernels, true).map(kernel => {
      const current = node.kernels.find(item => item.type === kernel.type);
      return current?.configPath ? { ...kernel, configPath: current.configPath } : kernel;
    });
    const deploymentId = randomUUID();
    const startedAt = Date.now();
    this.setProgress({ nodeId, deploymentId, step: 'connect', status: 'pending', message: '等待 SSH 连接', progress: 0, startedAt });
    await this.composition.repository.update(nodeId, current => ({
      ...current,
      agent: {
        deployed: current.agent?.deployed ?? false,
        version: current.agent?.version ?? '',
        lastDeploy: current.agent?.lastDeploy ?? '',
        port: current.port ?? current.agent?.port ?? 3001,
        status: 'deploying',
        deploymentId,
      },
    }));
    void this.runDeployment(node, requested, deploymentId, startedAt);
    return { deploymentId };
  }

  async startComponentDeployment(
    nodeId: string,
    componentValue: string,
    operationValue: string,
    input: { idempotencyKey?: string; options?: Partial<DeployOptions>; retryOf?: string } = {},
  ): Promise<{ taskId: string }> {
    const component = this.deployComponent(componentValue);
    const operation = this.deployOperation(operationValue);
    const active = Object.values(await this.getComponentDeployments([nodeId])).filter(item => item.status === 'pending' || item.status === 'running');
    const existing = active.find(item => item.component === component);
    if (existing) throw new Error(`${nodeId} 的 ${component} 已有进行中的任务 ${existing.taskId}`);
    const agentUninstallConflict = active.find(item => item.component === 'agent' && item.operation === 'uninstall');
    if (agentUninstallConflict || (component === 'agent' && operation === 'uninstall' && active.length > 0)) {
      throw new Error(`Agent 卸载与节点 ${nodeId} 的其他部署任务互斥`);
    }
    const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
    const duplicate = Object.values(await this.getComponentDeployments()).find(item => item.idempotencyKey === idempotencyKey);
    if (duplicate) return { taskId: duplicate.taskId };
    const taskId = randomUUID();
    const startedAt = Date.now();
    const options: DeployOptions = {
      preserveConfig: input.options?.preserveConfig !== false,
      preserveData: input.options?.preserveData !== false,
    };
    const initial: ComponentDeployStatus = {
      taskId, idempotencyKey, nodeId, component, operation, step: 'queued', status: 'pending',
      message: '任务已进入部署队列', progress: 0, actorRole: 'admin', options,
      createdAt: new Date(startedAt).toISOString(), startedAt,
      ...(input.retryOf ? { retryOf: input.retryOf } : {}),
    };
    await this.saveComponentStatus(initial);
    setTimeout(() => { void this.runComponentDeployment(taskId); }, 0);
    return { taskId };
  }

  async getComponentDeployment(taskId: string): Promise<ComponentDeployStatus | null> {
    await this.getComponentDeployments();
    return this.#componentProgress.get(taskId) ?? null;
  }

  async cancelComponentDeployment(taskId: string): Promise<ComponentDeployStatus> {
    const task = await this.requireComponentDeployment(taskId);
    if (task.status !== 'pending' && !(task.status === 'running' && task.step === 'prechecking')) {
      throw new Error('任务仅能在排队或预检阶段取消');
    }
    const cancelled: ComponentDeployStatus = {
      ...task, step: 'done', status: 'cancelled', progress: task.progress,
      message: '任务已取消，未继续执行远端写入', finishedAt: Date.now(),
    };
    await this.saveComponentStatus(cancelled);
    return cancelled;
  }

  async retryComponentDeployment(taskId: string): Promise<{ taskId: string }> {
    const task = await this.requireComponentDeployment(taskId);
    if (task.status !== 'error' && task.status !== 'cancelled') throw new Error('只有失败或已取消任务可以重试');
    return this.startComponentDeployment(task.nodeId, task.component, task.operation, {
      options: task.options, retryOf: task.taskId, idempotencyKey: randomUUID(),
    });
  }

  async getDeploymentEvents(taskId: string, afterEventId?: string): Promise<DeploymentEvent[]> {
    await this.requireComponentDeployment(taskId);
    const keys = (await this.composition.core.state.listKeys(`deployment-events/${taskId}/`)).sort();
    const events: DeploymentEvent[] = [];
    for (const key of keys) {
      const raw = await this.composition.core.state.get(key);
      if (!raw) continue;
      try {
        const event = JSON.parse(raw) as DeploymentEvent;
        if (!afterEventId || event.eventId > afterEventId) events.push(event);
      } catch { /* Ignore malformed historical events. */ }
    }
    return events;
  }

  async deploymentLog(taskId: string): Promise<string> {
    return (await this.getDeploymentEvents(taskId)).map(event =>
      `${event.timestamp} ${event.status.toUpperCase()} ${event.step} ${event.message}`).join('\n');
  }

  async manualAgentConfig(nodeId: string): Promise<string> {
    const node = await this.findNode(nodeId);
    const target: SshTarget = {
      nodeId: node.id, nodeName: node.name, secret: node.secret,
      agentPort: node.port ?? node.agent?.port ?? 3001, kernels: node.kernels,
      ssh: { host: node.host, user: node.ssh?.user ?? 'root', port: node.ssh?.port ?? 22, authMethod: 'password', hostKey: '' },
    };
    return this.agentYaml(target, node.kernels);
  }

  async getComponentDeployments(nodeIds?: readonly string[]): Promise<Record<string, ComponentDeployStatus>> {
    const keys = await this.composition.core.state.listKeys('deployment-tasks/');
    await Promise.all(keys.map(async key => {
      try {
        const raw = await this.composition.core.state.get(key);
        if (raw) {
          let status = this.normalizeComponentStatus(JSON.parse(raw));
          const wasLoaded = this.#componentProgress.has(status.taskId);
          if (status.status === 'running' && !wasLoaded) {
            status = { ...status, step: 'done', status: 'error', progress: 100, message: '任务因服务重启或执行超时而中断，可使用相同参数重试', errorCode: 'TASK_INTERRUPTED', finishedAt: Date.now() };
            await this.saveComponentStatus(status);
          } else {
            this.#componentProgress.set(status.taskId, status);
            if (status.status === 'pending' && !this.#resumedTasks.has(status.taskId)) {
              this.#resumedTasks.add(status.taskId);
              setTimeout(() => { void this.runComponentDeployment(status.taskId); }, 0);
            }
          }
        }
      } catch { /* Ignore malformed historical snapshots. */ }
    }));
    this.cleanupComponentProgress();
    const allowed = nodeIds ? new Set(nodeIds) : null;
    return Object.fromEntries([...this.#componentProgress.entries()].filter(([, item]) => !allowed || allowed.has(item.nodeId)));
  }

  getProgress(nodeId: string): DeployStatus | null {
    this.cleanupProgress();
    return this.#progress.get(nodeId) ?? null;
  }

  getAllProgress(nodeIds?: readonly string[]): Record<string, DeployStatus> {
    this.cleanupProgress();
    const allowed = nodeIds ? new Set(nodeIds) : null;
    return Object.fromEntries([...this.#progress.entries()].filter(([nodeId]) => !allowed || allowed.has(nodeId)));
  }

  async agentAction(nodeId: string, action: 'start' | 'stop' | 'restart' | 'uninstall', options: DeployOptions = { preserveConfig: false, preserveData: false }): Promise<void> {
    const target = await this.targetForNode(nodeId);
    const ssh = await this.connect(target);
    try {
      const userCommand = action === 'uninstall'
        ? [
            `${userSystemctl('disable', '--now', 'miobridge-agent.service')} 2>/dev/null || true`,
            `rm -f \"${AGENT_USER_BIN}\" \"${AGENT_USER_UNIT}\"`,
            ...(options.preserveConfig ? [] : [`rm -rf \"$HOME/.config/miobridge-agent\"`]),
            ...(options.preserveData ? [] : [`rm -rf \"$HOME/.local/share/miobridge-agent\"`]),
            userSystemctl('daemon-reload'),
          ].join(' && ')
        : userSystemctl(action, 'miobridge-agent.service');
      const userAgent = await this.exec(ssh, `test -x \"${AGENT_USER_BIN}\"`);
      const legacyAgent = await this.exec(ssh, `test -x ${shellQuote(LEGACY_AGENT_PATH)} || test -f ${shellQuote(LEGACY_AGENT_SERVICE_PATH)}`);
      const legacyCommand = action === 'uninstall'
        ? [
            'systemctl disable --now miobridge-agent 2>/dev/null || true',
            `rm -f ${shellQuote(LEGACY_AGENT_PATH)} ${shellQuote(LEGACY_AGENT_SERVICE_PATH)}`,
            ...(options.preserveConfig ? [] : ['rm -rf /etc/miobridge-agent']),
            ...(options.preserveData ? [] : ['rm -rf /var/lib/miobridge-agent']),
            'systemctl daemon-reload',
          ].join(' && ')
        : `systemctl ${action} miobridge-agent`;
      const executed = userAgent.code === 0 || legacyAgent.code !== 0
        ? await this.exec(ssh, userCommand)
        : await this.execRoot(ssh, target, legacyCommand);
      if (executed.code !== 0) throw new Error((executed.stderr || executed.stdout).trim() || `Agent ${action} 失败`);
      await this.composition.repository.update(nodeId, node => ({
        ...node,
        agent: {
          deployed: action !== 'uninstall',
          version: node.agent?.version ?? '',
          lastDeploy: node.agent?.lastDeploy ?? '',
          port: node.port ?? node.agent?.port ?? 3001,
          status: action === 'stop' || action === 'uninstall' ? (action === 'stop' ? 'stopped' : 'not_deployed') : 'running',
        },
      }));
    } finally {
      ssh.end();
    }
  }

  async installKernel(nodeId: string, kernelType: string): Promise<KernelDetection> {
    const type = this.kernelType(kernelType);
    const target = await this.targetForNode(nodeId);
    const ssh = await this.connect(target);
    try {
      await this.ensureKernel(ssh, target, { type });
      return await this.detectKernel(ssh, type);
    } finally {
      ssh.end();
    }
  }

  async uninstallKernel(nodeId: string, kernelType: string, options: DeployOptions = { preserveConfig: false, preserveData: false }): Promise<KernelDetection> {
    const type = this.kernelType(kernelType);
    const target = await this.targetForNode(nodeId);
    const ssh = await this.connect(target);
    try {
      const executed = await this.execWithPrivilegeFallback(ssh, target, uninstallCommand(type, options.preserveConfig));
      if (executed.code !== 0) throw new Error((executed.stderr || executed.stdout).trim() || `${type} 卸载失败`);
      return await this.detectKernel(ssh, type);
    } finally {
      ssh.end();
    }
  }

  async kernelAction(nodeId: string, kernelType: string, actionValue: string): Promise<{ nodeId: string; kernelType: KernelType; status: string }> {
    const type = this.kernelType(kernelType);
    const action = actionValue === 'start' || actionValue === 'stop' || actionValue === 'restart' ? actionValue : null;
    if (!action) throw new Error(`不支持的核心维护操作: ${actionValue}`);
    const target = await this.targetForNode(nodeId);
    const ssh = await this.connect(target);
    try {
      const executed = await this.execWithPrivilegeFallback(ssh, target, wrapperCommand(type, action));
      if (executed.code !== 0) throw new Error((executed.stderr || executed.stdout).trim() || `${type} ${action} 失败`);
      return { nodeId, kernelType: type, status: action === 'stop' ? 'stopped' : 'running' };
    } finally { ssh.end(); }
  }

  async detectMihomo(nodeId: string): Promise<MihomoDetection> {
    const target = await this.targetForNode(nodeId);
    const ssh = await this.connect(target);
    try { return await this.detectMihomoOn(ssh); }
    finally { ssh.end(); }
  }

  async installMihomo(nodeId: string): Promise<MihomoDetection> {
    const target = await this.targetForNode(nodeId);
    const ssh = await this.connect(target);
    try {
      const machine = await this.exec(ssh, 'uname -m');
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
      const installed = await this.exec(ssh, command);
      if (installed.code !== 0) throw new Error(`mihomo 安装失败: ${(installed.stderr || installed.stdout).trim().slice(-600)}`);
      return await this.detectMihomoOn(ssh);
    } finally { ssh.end(); }
  }

  async uninstallMihomo(nodeId: string): Promise<MihomoDetection> {
    const target = await this.targetForNode(nodeId);
    const ssh = await this.connect(target);
    try {
      const detected = await this.detectMihomoOn(ssh);
      const removed = detected.installed && detected.path === '/usr/local/bin/mihomo'
        ? await this.execRoot(ssh, target, 'rm -f /usr/local/bin/mihomo')
        : await this.exec(ssh, `rm -f \"${MIHOMO_USER_PATH}\" "$HOME/.local/bin/mihomo"`);
      if (removed.code !== 0) throw new Error((removed.stderr || removed.stdout).trim() || 'mihomo 卸载失败');
      return await this.detectMihomoOn(ssh);
    } finally { ssh.end(); }
  }

  private async runComponentDeployment(taskId: string): Promise<void> {
    const initial = await this.requireComponentDeployment(taskId);
    const { nodeId, component, operation, startedAt, options } = initial;
    const emit = (
      step: ComponentDeployStatus['step'], status: ComponentDeployStatus['status'],
      message: string, progress: number,
      patch: Partial<Pick<ComponentDeployStatus, 'beforeVersion' | 'afterVersion' | 'errorCode'>> = {},
    ) => this.updateComponentStatus(taskId, {
      step, status, message, progress, ...patch,
      ...(status === 'success' || status === 'error' || status === 'cancelled' ? { finishedAt: Date.now() } : {}),
    });
    try {
      if ((await this.requireComponentDeployment(taskId)).status === 'cancelled') return;
      const beforeVersion = await this.componentVersion(nodeId, component).catch(() => undefined);
      await emit('prechecking', 'running', '检查 SSH、架构与目标状态', 10, beforeVersion ? { beforeVersion } : {});
      await this.findNode(nodeId);
      if ((await this.requireComponentDeployment(taskId)).status === 'cancelled') return;
      if (component === 'agent') {
        if (operation === 'uninstall') {
          await emit('installing', 'running', '停止服务并卸载 Agent', 45);
          await this.agentAction(nodeId, 'uninstall', options);
        } else {
          await emit('downloading', 'running', '下载并校验 Agent 发布包', 30);
          await this.startDeployment(nodeId);
          await emit('installing', 'running', '安装并启动 Agent', 55);
          await this.waitForAgentDeployment(nodeId);
        }
      } else if (component === 'mihomo') {
        if (operation === 'uninstall') {
          await emit('installing', 'running', '卸载 mihomo', 45);
          await this.uninstallMihomo(nodeId);
        } else {
          await emit('downloading', 'running', '下载、校验并原子安装 mihomo', 35);
          await this.installMihomo(nodeId);
        }
      } else if (operation === 'uninstall') {
        await emit('installing', 'running', `卸载 ${component}`, 45);
        await this.uninstallKernel(nodeId, component, options);
        const node = await this.findNode(nodeId);
        if (node.agent?.deployed) {
          await emit('configuring', 'running', `从 Agent 监控中移除 ${component}`, 72);
          await this.configureKernels(nodeId, node.kernels.filter(item => item.type !== component));
        }
      } else {
        await emit('installing', 'running', operation === 'repair'
          ? `使用 233boy 脚本修复 ${component}`
          : operation === 'upgrade' ? `使用 233boy 脚本升级 ${component}`
            : operation === 'reinstall' ? `使用 233boy 脚本重装 ${component}` : `安装 ${component}`, 55);
        const detected = operation === 'repair'
          ? await this.repairKernel(nodeId, component)
          : operation === 'upgrade' ? await this.upgradeKernel(nodeId, component)
            : operation === 'reinstall' ? await this.reinstallKernel(nodeId, component, options)
              : await this.installKernel(nodeId, component);
        const node = await this.findNode(nodeId);
        if (node.agent?.deployed && !node.kernels.some(item => item.type === component)) {
          await emit('configuring', 'running', `将 ${component} 加入 Agent 监控`, 78);
          await this.configureKernels(nodeId, [...node.kernels, { type: component, configPath: detected.defaultConfigPath }]);
        }
      }
      await emit('postchecking', 'running', '验证安装结果与运行状态', 92);
      if (component === 'mihomo') {
        const result = await this.detectMihomo(nodeId);
        if ((operation === 'uninstall') === result.installed) throw new Error('mihomo 部署后验证失败');
      } else if (component !== 'agent') {
        const result = (await this.detect({ nodeId })).find(item => item.type === component);
        if (!result || (operation === 'uninstall') === result.installed) throw new Error(`${component} 部署后验证失败`);
      }
      const afterVersion = await this.componentVersion(nodeId, component).catch(() => undefined);
      await emit('done', 'success', `${component} ${operation} 已完成并通过验证`, 100, afterVersion ? { afterVersion } : {});
    } catch (error) {
      if ((await this.requireComponentDeployment(taskId)).status === 'cancelled') return;
      await emit('done', 'error', error instanceof Error ? error.message : '部署任务失败', 100, { errorCode: 'DEPLOYMENT_FAILED' });
    }
  }

  private async componentVersion(nodeId: string, component: DeployComponent): Promise<string | undefined> {
    if (component === 'agent') return (await this.findNode(nodeId)).agent?.version || undefined;
    if (component === 'mihomo') return (await this.detectMihomo(nodeId)).version;
    return (await this.detect({ nodeId })).find(item => item.type === component)?.version;
  }

  private async repairKernel(nodeId: string, type: KernelType): Promise<KernelDetection> {
    const target = await this.targetForNode(nodeId);
    const ssh = await this.connect(target);
    try {
      await this.ensureKernel(ssh, target, { type });
      const repaired = await this.execWithPrivilegeFallback(ssh, target, repairCommand(type));
      if (repaired.code !== 0) throw new Error((repaired.stderr || repaired.stdout).trim() || `${type} 修复检查失败`);
      return await this.detectKernel(ssh, type);
    } finally { ssh.end(); }
  }

  private async upgradeKernel(nodeId: string, type: KernelType): Promise<KernelDetection> {
    const target = await this.targetForNode(nodeId);
    const ssh = await this.connect(target);
    try {
      await this.ensureKernel(ssh, target, { type });
      const upgraded = await this.execWithPrivilegeFallback(ssh, target, upgradeCommand(type));
      if (upgraded.code !== 0) throw new Error((upgraded.stderr || upgraded.stdout).trim() || `${type} 升级失败`);
      return await this.detectKernel(ssh, type);
    } finally { ssh.end(); }
  }

  private async reinstallKernel(nodeId: string, type: KernelType, options: DeployOptions): Promise<KernelDetection> {
    const target = await this.targetForNode(nodeId);
    const ssh = await this.connect(target);
    try {
      const reinstalled = await this.execWithPrivilegeFallback(ssh, target, reinstallCommand(type, options.preserveConfig));
      if (reinstalled.code !== 0) throw new Error((reinstalled.stderr || reinstalled.stdout).trim() || `${type} 重装失败`);
      return await this.detectKernel(ssh, type);
    } finally { ssh.end(); }
  }

  private async waitForAgentDeployment(nodeId: string): Promise<void> {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const status = this.#progress.get(nodeId);
      if (status?.status === 'success') return;
      if (status?.status === 'error') throw new Error(status.message);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Agent 部署验证超时');
  }

  /**
   * Apply the monitored-kernel selection to an already deployed Agent.
   * The repository is updated only after the remote config has been written,
   * the service restarted, and its health endpoint verified.
   */
  async configureKernels(nodeId: string, kernels: readonly NodeKernelConfig[]): Promise<NodeConfig> {
    const node = await this.findNode(nodeId);
    if (!node.agent?.deployed) throw new Error('请先部署 Agent，再配置监控内核');
    const target = await this.targetForNode(nodeId, kernels);
    const ssh = await this.connect(target);
    let replaced = false;
    try {
      for (const kernel of kernels) {
        const path = kernel.configPath ?? DEFAULT_CONFIG_PATHS[kernel.type];
        const checked = await this.exec(ssh, `test -r ${shellQuote(path)}`);
        if (checked.code !== 0) throw new Error(`${kernel.type} 监控路径不可读: ${path}`);
      }
      replaced = await this.replaceAgentConfig(ssh, target, this.agentYaml(target, kernels));
      await this.startAgent(ssh, target);
      await this.verifyAgent(ssh, target);
      const updated = await this.composition.repository.update(nodeId, current => ({
        ...current,
        kernels: [...kernels],
        ...(current.ssh ? { ssh: { ...current.ssh, hostKey: target.ssh.hostKey } } : {}),
        ...(current.agent ? { agent: { ...current.agent, status: 'running' as const } } : {}),
      }));
      await this.exec(ssh, 'rm -f "$HOME/.config/miobridge-agent/agent.yaml.rollback"');
      return updated;
    } catch (error) {
      if (replaced) {
        await this.exec(ssh, `if [ -f "$HOME/.config/miobridge-agent/agent.yaml.rollback" ]; then cp "$HOME/.config/miobridge-agent/agent.yaml.rollback" "$HOME/.config/miobridge-agent/agent.yaml"; ${userSystemctl('restart', 'miobridge-agent.service')} || true; else rm -f "$HOME/.config/miobridge-agent/agent.yaml"; ${userSystemctl('stop', 'miobridge-agent.service')} || true; fi`).catch(() => undefined);
      }
      throw error;
    } finally {
      ssh.end();
    }
  }

  private async replaceAgentConfig(ssh: DeploymentConnection, target: SshTarget, content: string): Promise<boolean> {
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
    const result = await this.exec(ssh, `bash -c ${shellQuote(script)}`);
    if (result.code !== 0) throw new Error(`Agent 配置校验或原子替换失败: ${(result.stderr || result.stdout).trim()}`);
    return true;
  }

  private async runDeployment(
    node: NodeConfig,
    kernels: NodeKernelConfig[],
    deploymentId: string,
    startedAt: number,
  ): Promise<void> {
    let target: SshTarget | undefined;
    let ssh: DeploymentConnection | undefined;
    const emit = (step: DeployStatus['step'], status: DeployStatus['status'], message: string, progress: number) => {
      if (this.#progress.get(node.id)?.deploymentId === deploymentId) {
        this.setProgress({ nodeId: node.id, deploymentId, step, status, message, progress, startedAt });
      }
    };
    try {
      emit('connect', 'running', '正在建立 SSH 连接', 5);
      target = await this.targetForNode(node.id, kernels);
      ssh = await this.connect(target);
      emit('connect', 'success', 'SSH 连接成功', 15);

      const monitored: NodeKernelConfig[] = [];
      for (const kernel of kernels) {
        emit('kernel', 'running', `检查 ${kernel.type} 内核`, 25);
        const detected = await this.detectKernel(ssh, kernel.type);
        const configPath = kernel.configPath ?? detected.defaultConfigPath;
        const readable = detected.installed ? await this.exec(ssh, `test -r ${shellQuote(configPath)}`) : { code: 1 };
        if (detected.installed && readable.code === 0) monitored.push({ ...kernel, configPath });
      }
      emit('kernel', 'success', `${monitored.length} 个已安装且可读的内核将由 Agent 监控；未安装内核不会自动安装`, 50);

      emit('agent', 'running', '下载并安装已校验 Agent', 60);
      await this.installAgent(ssh, target, monitored);
      emit('agent', 'success', 'Agent 已安装', 80);

      emit('start', 'running', '启动 Agent 服务', 85);
      await this.startAgent(ssh, target);
      emit('start', 'success', 'Agent 已启动', 92);

      emit('verify', 'running', '验证 Agent 健康状态', 95);
      await this.verifyAgent(ssh, target);
      emit('verify', 'success', 'Agent 健康检查通过', 98);

      await this.completeNode(node.id, deploymentId, current => ({
        ...current,
        kernels: monitored,
        ...(current.ssh ? { ssh: { ...current.ssh, hostKey: target!.ssh.hostKey } } : {}),
        agent: {
          deployed: true,
          version: process.env.MIOBRIDGE_BUILD_VERSION ?? current.agent?.version ?? '',
          status: 'running',
          lastDeploy: new Date().toISOString(),
          port: target!.agentPort,
        },
      }));
      emit('done', 'success', `Agent 已部署到节点 ${node.name}`, 100);
    } catch (error) {
      const message = error instanceof Error ? error.message : '部署失败';
      await this.completeNode(node.id, deploymentId, current => ({
        ...current,
        ...(target && current.ssh ? { ssh: { ...current.ssh, hostKey: target.ssh.hostKey } } : {}),
        agent: {
          deployed: current.agent?.deployed ?? false,
          version: current.agent?.version ?? '',
          status: 'error',
          lastDeploy: new Date().toISOString(),
          port: current.port ?? current.agent?.port ?? 3001,
        },
      }));
      const current = this.#progress.get(node.id);
      emit(current?.step ?? 'connect', 'error', message, current?.progress ?? 0);
    } finally {
      ssh?.end();
    }
  }

  private async completeNode(nodeId: string, deploymentId: string, update: (node: NodeConfig) => NodeConfig): Promise<void> {
    await this.composition.repository.update(nodeId, node => node.agent?.deploymentId === deploymentId ? update(node) : node);
  }

  private async findNode(nodeId: string): Promise<NodeConfig> {
    const node = (await this.composition.repository.list({ enabledOnly: false })).find(item => item.id === nodeId);
    if (!node) throw new Error(`节点 ${nodeId} 不存在`);
    return node;
  }

  private async targetForNode(nodeId: string, kernels?: readonly NodeKernelConfig[]): Promise<SshTarget> {
    const node = await this.findNode(nodeId);
    if (node.id === 'local') {
      return {
        local: true,
        nodeId: node.id,
        nodeName: node.name,
        secret: node.secret,
        agentPort: node.port ?? node.agent?.port ?? 3001,
        kernels: kernels ?? node.kernels,
        ssh: {
          host: '127.0.0.1',
          user: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root' : process.env.USER ?? 'miobridge',
          port: 0,
          authMethod: 'password',
          hostKey: '',
        },
      };
    }
    if (!node.ssh?.credentialRef) throw new Error('节点未配置 SSH 凭据');
    const credential = await this.composition.core.state.get(node.ssh.credentialRef);
    if (!credential) throw new Error('节点 SSH 凭据不存在');
    if (node.ssh.authMethod === 'privateKey') validatePrivateKey(credential);
    return {
      nodeId: node.id,
      nodeName: node.name,
      secret: node.secret,
      agentPort: node.port ?? node.agent?.port ?? 3001,
      kernels: kernels ?? node.kernels,
      ssh: {
        host: node.host,
        user: node.ssh.user,
        port: node.ssh.port ?? 22,
        authMethod: node.ssh.authMethod,
        hostKey: node.ssh.hostKey,
        ...(node.ssh.authMethod === 'privateKey' ? { privateKey: credential } : { password: credential }),
      },
    };
  }

  private async targetFromSsh(input: Record<string, unknown>): Promise<SshTarget> {
    const host = typeof input.host === 'string' ? input.host.trim() : '';
    const user = typeof input.user === 'string' ? input.user.trim() : '';
    const authMethod = input.authMethod === 'privateKey' ? 'privateKey' : input.authMethod === 'password' ? 'password' : null;
    const port = input.port === undefined ? 22 : Number(input.port);
    if (!host || !user || !authMethod) throw new Error('SSH 连接信息不完整');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 端口无效');
    const credential = authMethod === 'privateKey' ? input.privateKey : input.password;
    if (typeof credential !== 'string' || !credential) throw new Error('SSH 凭据不完整');
    if (authMethod === 'privateKey') validatePrivateKey(credential);
    return {
      nodeId: 'kernel-detection', nodeName: 'kernel-detection', secret: '', agentPort: 3001, kernels: [],
      ssh: {
        host, user, port, authMethod, hostKey: typeof input.hostKey === 'string' ? input.hostKey : '',
        ...(authMethod === 'privateKey' ? { privateKey: credential } : { password: credential }),
      },
    };
  }

  private connect(target: SshTarget): Promise<DeploymentConnection> {
    if (target.local) {
      return Promise.resolve({
        run: (command, input) => this.runLocal(command, input),
        end() {},
      });
    }
    return new Promise((resolve, reject) => {
      const client = new Client();
      const authentication: Pick<ConnectConfig, 'password' | 'privateKey'> = target.ssh.authMethod === 'privateKey'
        ? { privateKey: target.ssh.privateKey! }
        : { password: target.ssh.password! };
      const options: ConnectConfig = {
        host: target.ssh.host,
        port: target.ssh.port,
        username: target.ssh.user,
        readyTimeout: 15_000,
        ...authentication,
        hostHash: 'sha256',
        hostVerifier: (hashed: Buffer) => {
          const fingerprint = Buffer.isBuffer(hashed) ? hashed.toString('base64') : String(hashed);
          if (target.ssh.hostKey) return fingerprint === target.ssh.hostKey;
          target.ssh.hostKey = fingerprint;
          return true;
        },
      };
      client.once('ready', () => resolve({
        run: (command, input) => new Promise((resolveCommand, rejectCommand) => {
          client.exec(command, (error: Error | undefined, channel: ClientChannel) => {
            if (error) { rejectCommand(error); return; }
            let stdout = '';
            let stderr = '';
            channel.on('data', (data: Buffer) => { stdout += data.toString(); });
            channel.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
            channel.on('close', (code: number) => resolveCommand({ stdout, stderr, code: code ?? -1 }));
            if (input === undefined) channel.end(); else channel.end(input);
          });
        }),
        end: () => client.end(),
      }));
      client.once('error', error => reject(new Error(`SSH 连接失败: ${error.message}`)));
      client.connect(options);
    });
  }

  private exec(ssh: DeploymentConnection, command: string, input?: string): Promise<ExecResult> {
    return ssh.run(command, input);
  }

  private runLocal(command: string, input?: string): Promise<ExecResult> {
    if (this.options.runLocal) return this.options.runLocal(command, input);
    return new Promise((resolve, reject) => {
      const child = spawn('/bin/bash', ['-lc', command], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', data => { stdout += data.toString(); });
      child.stderr.on('data', data => { stderr += data.toString(); });
      child.once('error', reject);
      child.once('close', code => resolve({ stdout, stderr, code: code ?? -1 }));
      if (input === undefined) child.stdin.end(); else child.stdin.end(input);
    });
  }

  private execRoot(ssh: DeploymentConnection, target: SshTarget, command: string): Promise<ExecResult> {
    if (target.ssh.user === 'root') return this.exec(ssh, command);
    const elevated = target.ssh.password
      ? `sudo -S -p '' bash -lc ${shellQuote(command)}`
      : `sudo -n bash -lc ${shellQuote(command)}`;
    return this.exec(ssh, elevated, target.ssh.password ? `${target.ssh.password}\n` : undefined);
  }

  private async execWithPrivilegeFallback(ssh: DeploymentConnection, target: SshTarget, command: string): Promise<ExecResult> {
    const direct = await this.exec(ssh, command);
    if (direct.code === 0 || target.ssh.user === 'root') return direct;
    const output = `${direct.stdout}\n${direct.stderr}`;
    if (!/permission denied|operation not permitted|must (?:be run|run) as root|requires? root|(?:当前)?非.*root.*用户|需要.*(?:root|管理员)|请.*root/iu.test(output)) {
      return direct;
    }
    return this.execRoot(ssh, target, command);
  }

  private async detectKernel(ssh: DeploymentConnection, type: KernelType): Promise<KernelDetection> {
    try {
      const definition = KERNEL_SCRIPTS[type];
      const probe = [
        `test -x ${shellQuote(definition.wrapperPath)}`,
        `${wrapperCommand(type, 'help')} 2>&1 | grep -F 'url [name]' >/dev/null`,
        `${wrapperCommand(type, 'version')} 2>&1`,
      ].join(' && ');
      const result = await this.exec(ssh, probe);
      const output = (result.stdout || result.stderr).replace(/\u001b\[[0-9;]*m/g, '').trim();
      const version = output.split(/\r?\n/).find(line => line.trim())?.trim();
      // probe 的第一步就是 test -x wrapperPath，code === 0 意味着这个路径
      // 在目标主机上确实存在且可执行，可以如实上报，不需要前端再去猜。
      return result.code === 0
        ? { type, installed: true, ...(version ? { version } : {}), defaultConfigPath: DEFAULT_CONFIG_PATHS[type], binaryPath: definition.wrapperPath }
        : {
            type, installed: false, defaultConfigPath: DEFAULT_CONFIG_PATHS[type],
            error: output || `未找到兼容的 233boy ${type} 管理脚本: ${definition.wrapperPath}`,
          };
    } catch (error) {
      return { type, installed: false, defaultConfigPath: DEFAULT_CONFIG_PATHS[type], error: error instanceof Error ? error.message : '检测失败' };
    }
  }

  private async detectMihomoOn(ssh: DeploymentConnection): Promise<MihomoDetection> {
    try {
      const result = await this.exec(ssh, 'for candidate in "$HOME/.config/miobridge/bin/mihomo" "$HOME/.local/bin/mihomo" /usr/local/bin/mihomo; do if [ -x "$candidate" ]; then printf "%s\\n" "$candidate"; "$candidate" -v 2>&1; exit $?; fi; done; exit 127');
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

  private async ensureKernel(ssh: DeploymentConnection, target: SshTarget, kernel: NodeKernelConfig): Promise<void> {
    if ((await this.detectKernel(ssh, kernel.type)).installed) return;
    const installed = await this.execWithPrivilegeFallback(ssh, target, installCommand(kernel.type));
    if (installed.code !== 0 && !/installed|success|生成配置文件|链接 \(URL\)|使用协议/.test(installed.stdout)) {
      throw new Error(`${kernel.type} 安装失败: ${(installed.stderr || installed.stdout).trim()}`);
    }
    if (!(await this.detectKernel(ssh, kernel.type)).installed) throw new Error(`${kernel.type} 安装后检测失败`);
  }

  private async installAgent(ssh: DeploymentConnection, target: SshTarget, kernels: readonly NodeKernelConfig[]): Promise<void> {
    const detected = await this.exec(ssh, 'uname -m');
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
    const installed = await this.exec(ssh, `bash -c ${shellQuote(installScript)}`);
    if (installed.code !== 0) throw new Error(`Agent 安装或校验失败: ${(installed.stderr || installed.stdout).trim().slice(-600)}`);
    await this.writeUserFile(ssh, 'miobridge-agent/agent.yaml', this.agentYaml(target, kernels), 0o600, 'config');
    await this.writeUserFile(ssh, 'miobridge-agent.service', this.systemdUnit(), 0o644, 'unit');
  }

  private async writeUserFile(ssh: DeploymentConnection, relative: string, content: string, mode: number, kind: 'config' | 'unit'): Promise<void> {
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
    const written = await this.exec(ssh, `bash -c ${shellQuote(script)}`);
    if (written.code !== 0) throw new Error(`写入用户态 Agent 文件失败: ${(written.stderr || written.stdout).trim()}`);
  }

  private agentYaml(target: SshTarget, kernels: readonly NodeKernelConfig[]): string {
    const kernelYaml = kernels.map(kernel => [
      `  - type: ${JSON.stringify(kernel.type)}`,
      `    configPath: ${JSON.stringify(kernel.configPath ?? DEFAULT_CONFIG_PATHS[kernel.type])}`,
    ].join('\n')).join('\n');
    const kernelsBlock = kernelYaml ? `kernels:\n${kernelYaml}` : 'kernels: []';
    return `node:\n  id: ${JSON.stringify(target.nodeId)}\n  name: ${JSON.stringify(target.nodeName)}\n  secret: ${JSON.stringify(target.secret)}\n${kernelsBlock}\nmihomo:\n  path: "mihomo"\nport: ${target.agentPort}\n`;
  }

  private systemdUnit(): string {
    return `[Unit]\nDescription=MioBridge Agent\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=%h/.local/bin/miobridge-agent --config %h/.config/miobridge-agent/agent.yaml\nWorkingDirectory=%h/.config/miobridge-agent\nEnvironment=PATH=%h/.config/miobridge/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin\nRestart=always\nRestartSec=5\nNoNewPrivileges=true\nPrivateTmp=true\n\n[Install]\nWantedBy=default.target\n`;
  }

  private async startAgent(ssh: DeploymentConnection, target: SshTarget): Promise<void> {
    const legacy = await this.exec(ssh, `test -x ${shellQuote(LEGACY_AGENT_PATH)} || test -f ${shellQuote(LEGACY_AGENT_SERVICE_PATH)} || test -f ${shellQuote(LEGACY_AGENT_CONFIG_PATH)}`);
    if (legacy.code === 0) throw new Error('检测到旧版系统级 Agent。请先由管理员执行 "sudo systemctl disable --now miobridge-agent" 并删除旧 unit，之后重试用户态部署。');
    const started = await this.exec(ssh, `${userSystemctl('daemon-reload')} && ${userSystemctl('enable', '--now', 'miobridge-agent.service')} && ${userSystemctl('restart', 'miobridge-agent.service')}`);
    if (started.code !== 0) throw new Error(`Agent 启动失败: ${(started.stderr || started.stdout).trim()}`);
  }

  private async verifyAgent(ssh: DeploymentConnection, target: SshTarget): Promise<void> {
    const checked = await this.exec(ssh, `for i in 1 2 3 4 5; do code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${target.agentPort}/health || true); [ "$code" = 200 ] && exit 0; sleep 2; done; exit 1`);
    if (checked.code !== 0) throw new Error('Agent 健康检查失败');
  }

  private kernelType(value: string): KernelType {
    if (!KERNEL_TYPES.includes(value as KernelType)) throw new Error(`不支持的内核类型: ${value}`);
    return value as KernelType;
  }

  private deployComponent(value: string): DeployComponent {
    if (value === 'agent' || value === 'mihomo' || KERNEL_TYPES.includes(value as KernelType)) return value as DeployComponent;
    throw new Error(`不支持的部署内容: ${value}`);
  }

  private deployOperation(value: string): DeployOperation {
    if (['install', 'reinstall', 'upgrade', 'repair', 'uninstall'].includes(value)) return value as DeployOperation;
    throw new Error(`不支持的部署操作: ${value}`);
  }

  private setProgress(status: DeployStatus): void {
    this.#progress.set(status.nodeId, status);
  }

  private cleanupProgress(): void {
    const now = Date.now();
    for (const [nodeId, status] of this.#progress) {
      if ((status.status === 'success' || status.status === 'error') && now - status.startedAt > PROGRESS_TTL_MS) {
        this.#progress.delete(nodeId);
      }
    }
  }

  private cleanupComponentProgress(): void {
    const now = Date.now();
    for (const [taskId, status] of this.#componentProgress) {
      if (status.finishedAt && now - status.finishedAt > TASK_HISTORY_TTL_MS) {
        this.#componentProgress.delete(taskId);
        void (async () => {
          await this.composition.core.state.del(`deployment-tasks/${taskId}.json`);
          for (const key of await this.composition.core.state.listKeys(`deployment-events/${taskId}/`)) {
            await this.composition.core.state.del(key);
          }
        })();
      }
    }
  }

  private async saveComponentStatus(status: ComponentDeployStatus): Promise<void> {
    this.#componentProgress.set(status.taskId, status);
    await this.composition.core.state.set(`deployment-tasks/${status.taskId}.json`, JSON.stringify(status));
    await this.appendDeploymentEvent(status);
  }

  private async updateComponentStatus(
    taskId: string,
    patch: Pick<ComponentDeployStatus, 'step' | 'status' | 'message' | 'progress'>
      & Partial<Pick<ComponentDeployStatus, 'finishedAt' | 'beforeVersion' | 'afterVersion' | 'errorCode'>>,
  ): Promise<ComponentDeployStatus> {
    const current = await this.requireComponentDeployment(taskId);
    const next = { ...current, ...patch };
    await this.saveComponentStatus(next);
    return next;
  }

  private async requireComponentDeployment(taskId: string): Promise<ComponentDeployStatus> {
    const existing = this.#componentProgress.get(taskId);
    if (existing) return existing;
    const raw = await this.composition.core.state.get(`deployment-tasks/${taskId}.json`);
    if (!raw) throw new Error(`部署任务 ${taskId} 不存在`);
    const status = this.normalizeComponentStatus(JSON.parse(raw));
    this.#componentProgress.set(taskId, status);
    return status;
  }

  private normalizeComponentStatus(value: unknown): ComponentDeployStatus {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('部署任务快照无效');
    const task = value as Partial<ComponentDeployStatus>;
    if (!task.taskId || !task.nodeId || !task.component || !task.operation || !task.step || !task.status) throw new Error('部署任务缺少必要字段');
    const startedAt = typeof task.startedAt === 'number' ? task.startedAt : Date.now();
    return {
      taskId: task.taskId,
      idempotencyKey: task.idempotencyKey ?? task.taskId,
      nodeId: task.nodeId,
      component: task.component,
      operation: task.operation,
      step: legacyStep(task.step),
      status: task.status,
      message: task.message ?? '',
      progress: task.progress ?? 0,
      actorRole: task.actorRole ?? 'admin',
      options: task.options ?? { preserveConfig: true, preserveData: true },
      createdAt: task.createdAt ?? new Date(startedAt).toISOString(),
      startedAt,
      ...(task.finishedAt !== undefined ? { finishedAt: task.finishedAt } : {}),
      ...(task.beforeVersion ? { beforeVersion: task.beforeVersion } : {}),
      ...(task.afterVersion ? { afterVersion: task.afterVersion } : {}),
      ...(task.retryOf ? { retryOf: task.retryOf } : {}),
      ...(task.errorCode ? { errorCode: task.errorCode } : {}),
    };
  }

  private async appendDeploymentEvent(status: ComponentDeployStatus): Promise<void> {
    let counter = this.#eventCounters.get(status.taskId);
    if (counter === undefined) {
      counter = (await this.composition.core.state.listKeys(`deployment-events/${status.taskId}/`)).length;
    }
    counter += 1;
    this.#eventCounters.set(status.taskId, counter);
    const eventId = String(counter).padStart(8, '0');
    const event: DeploymentEvent = {
      eventId, taskId: status.taskId, nodeId: status.nodeId, component: status.component,
      step: status.step, status: status.status, progress: status.progress,
      message: status.message, timestamp: new Date().toISOString(),
    };
    await this.composition.core.state.set(`deployment-events/${status.taskId}/${eventId}.json`, JSON.stringify(event));
  }
}

async function networkPreflight(host: string, port: number): Promise<{ dns: { ok: boolean; detail: string }; tcp: { ok: boolean; detail: string } }> {
  let address = host;
  try {
    if (!isIP(host)) address = (await lookup(host)).address;
  } catch (error) {
    return { dns: { ok: false, detail: error instanceof Error ? error.message : '解析失败' }, tcp: { ok: false, detail: '未执行：DNS 失败' } };
  }
  const tcp = await new Promise<{ ok: boolean; detail: string }>(resolve => {
    const socket = createConnection({ host: address, port });
    const timer = setTimeout(() => finish(false, `连接 ${address}:${port} 超时`), 5_000);
    function finish(ok: boolean, detail: string) { clearTimeout(timer); socket.destroy(); resolve({ ok, detail }); }
    socket.once('connect', () => finish(true, `${address}:${port} 可达`));
    socket.once('error', error => finish(false, error.message));
  });
  return { dns: { ok: true, detail: isIP(host) ? `${host}（IP 地址）` : `${host} → ${address}` }, tcp };
}

function legacyStep(step: ComponentDeployStatus['step'] | 'preflight' | 'install' | 'configure' | 'verify'): ComponentDeployStatus['step'] {
  if (step === 'preflight') return 'prechecking';
  if (step === 'install') return 'installing';
  if (step === 'configure') return 'configuring';
  if (step === 'verify') return 'postchecking';
  return step;
}
