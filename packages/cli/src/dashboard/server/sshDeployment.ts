import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import {
  KERNEL_TYPES,
  isLocalNode,
  validateNodeKernels,
  type KernelType,
  type NodeConfig,
  type NodeKernelConfig,
  type NodeStatus,
} from '@miobridge/core';
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import type { NodeCoreComposition } from '../../composition.js';
import type { LocalKernelInstaller } from '../../setup/kernelService.js';

const AGENT_REMOTE_PATH = '/usr/local/bin/miobridge-agent';
const AGENT_CONFIG_PATH = '/etc/miobridge-agent/agent.yaml';
const AGENT_SERVICE_PATH = '/etc/systemd/system/miobridge-agent.service';
const PROGRESS_TTL_MS = 10 * 60 * 1000;

const KERNEL_INSTALL_COMMANDS: Record<KernelType, string> = {
  'sing-box': 'wget -qO- https://github.com/233boy/sing-box/raw/main/install.sh | bash',
  xray: 'wget -qO- https://github.com/233boy/Xray/raw/main/install.sh | bash',
  v2ray: 'wget -qO- https://github.com/233boy/v2ray/raw/master/install.sh | bash',
};

const KERNEL_REMOVE_COMMANDS: Record<KernelType, string> = {
  'sing-box': 'command -v sb >/dev/null 2>&1 && sb uninstall || systemctl disable --now sing-box 2>/dev/null || true',
  xray: 'command -v xray >/dev/null 2>&1 && xray uninstall || systemctl disable --now xray 2>/dev/null || true',
  v2ray: 'command -v v2ray >/dev/null 2>&1 && v2ray uninstall || systemctl disable --now v2ray 2>/dev/null || true',
};

const DEFAULT_CONFIG_PATHS: Record<KernelType, string> = {
  'sing-box': '/etc/sing-box/config.json',
  xray: '/usr/local/etc/xray/config.json',
  v2ray: '/etc/v2ray/config.json',
};

export interface KernelDetection {
  readonly type: KernelType;
  readonly installed: boolean;
  readonly version?: string;
  readonly defaultConfigPath: string;
  readonly error?: string;
}

export interface DeployStatus {
  readonly nodeId: string;
  readonly deploymentId: string;
  readonly scope: DeploymentScope;
  readonly step: 'connect' | 'configure' | 'kernel' | 'agent' | 'start' | 'verify' | 'done';
  readonly status: 'pending' | 'running' | 'success' | 'error' | 'no_kernels';
  readonly message: string;
  readonly progress: number;
  readonly startedAt: number;
}

export type DeploymentScope = 'listener' | 'kernels' | 'all';

export type DeploymentCheckCategory = 'prerequisite' | 'listener' | 'kernel';
export type DeploymentCheckStatus = 'ready' | 'action_required' | 'blocked';

export interface DeploymentCheck {
  readonly id: string;
  readonly category: DeploymentCheckCategory;
  readonly label: string;
  readonly status: DeploymentCheckStatus;
  readonly message: string;
  readonly kernelType?: KernelType;
}

export interface DeploymentPlan {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly kind: 'local' | 'child';
  readonly preflightReady: boolean;
  readonly deployable: boolean;
  readonly ready: boolean;
  readonly recommendedScope: DeploymentScope | null;
  readonly blockers: readonly string[];
  readonly checks: readonly DeploymentCheck[];
  readonly target?: {
    readonly host: string;
    readonly user: string;
    readonly port: number;
  };
}

export interface DeploymentPlanOptions {
  readonly sshConfigured?: boolean;
  readonly credentialAvailable?: boolean;
  readonly sshHost?: string;
  readonly sshUser?: string;
  readonly sshPort?: number;
}

export function isDeploymentScope(value: unknown): value is DeploymentScope {
  return value === 'listener' || value === 'kernels' || value === 'all';
}

function isLocalRuntimeNode(node: NodeStatus): boolean {
  return node.kind === 'local' || node.nodeId === 'local';
}

function listenerStatus(node: NodeStatus): { deployed: boolean; listening: boolean; error?: string } {
  return node.listener ?? (isLocalRuntimeNode(node)
    ? { deployed: true, listening: node.online }
    : { deployed: Boolean(node.agent?.deployed), listening: node.online });
}

export function planNodeDeployment(node: NodeStatus, options: DeploymentPlanOptions = {}): DeploymentPlan {
  const local = isLocalRuntimeNode(node);
  const checks: DeploymentCheck[] = [];
  const blockers: string[] = [];

  if (local) {
    checks.push({
      id: 'prerequisite:local', category: 'prerequisite', label: '本机执行环境', status: 'ready',
      message: '由当前 MioBridge 服务直接部署',
    });
  } else if (!options.sshConfigured) {
    const message = '未配置 SSH 连接信息';
    blockers.push(message);
    checks.push({ id: 'prerequisite:ssh', category: 'prerequisite', label: 'SSH 凭据', status: 'blocked', message });
  } else if (!options.credentialAvailable) {
    const message = 'SSH 凭据已丢失，需要重新配置节点';
    blockers.push(message);
    checks.push({ id: 'prerequisite:ssh', category: 'prerequisite', label: 'SSH 凭据', status: 'blocked', message });
  } else {
    checks.push({
      id: 'prerequisite:ssh', category: 'prerequisite', label: 'SSH 凭据', status: 'ready',
      message: '连接信息和凭据已保存',
    });
  }

  const listener = listenerStatus(node);
  const listenerReady = listener.deployed && listener.listening;
  checks.push({
    id: 'listener', category: 'listener', label: local ? '本机监听程序' : 'Agent 监听程序',
    status: listenerReady ? 'ready' : 'action_required',
    message: listenerReady
      ? '已部署并成功监听'
      : !listener.deployed
        ? `尚未部署${listener.error ? `：${listener.error}` : ''}`
        : `未成功监听${listener.error ? `：${listener.error}` : ''}`,
  });

  if (node.configuredKernels.length === 0) {
    const message = '未配置内核，请先选择至少一个内核';
    blockers.push(message);
    checks.push({
      id: 'kernel:none', category: 'kernel', label: '内核配置', status: 'blocked', message,
    });
  } else {
    const runtimeByType = new Map(node.kernels.map(kernel => [kernel.type, kernel]));
    for (const configured of node.configuredKernels) {
      const runtime = runtimeByType.get(configured.type);
      let status: DeploymentCheckStatus = 'ready';
      let message = runtime?.version ? `已就绪 · ${runtime.version}` : '已部署、监听且可访问';
      if (!runtime?.detected) {
        status = 'action_required';
        message = `尚未安装${runtime?.error ? `：${runtime.error}` : ''}`;
      } else if (!runtime.monitored) {
        status = 'action_required';
        message = '已安装，但监听程序尚未加载';
      } else if (!runtime.accessible) {
        status = 'action_required';
        message = `监听配置不可访问${runtime.error ? `：${runtime.error}` : ''}`;
      }
      checks.push({
        id: `kernel:${configured.type}`, category: 'kernel', label: configured.type,
        status, message, kernelType: configured.type,
      });
    }
  }

  const prerequisiteReady = checks
    .filter(check => check.category === 'prerequisite')
    .every(check => check.status === 'ready');
  const hasKernels = node.configuredKernels.length > 0;
  const kernelsReady = hasKernels && checks
    .filter(check => check.category === 'kernel')
    .every(check => check.status === 'ready');
  const deployable = prerequisiteReady && hasKernels;
  const ready = deployable && listenerReady && kernelsReady;
  const recommendedScope: DeploymentScope | null = !deployable || ready
    ? null
    : !listenerReady && !kernelsReady
      ? 'all'
      : !listenerReady ? 'listener' : 'kernels';

  return {
    nodeId: node.nodeId,
    nodeName: node.name,
    kind: local ? 'local' : 'child',
    preflightReady: deployable,
    deployable,
    ready,
    recommendedScope,
    blockers,
    checks,
    ...(!local && options.sshHost && options.sshUser ? {
      target: { host: options.sshHost, user: options.sshUser, port: options.sshPort ?? 22 },
    } : {}),
  };
}

export function assessNodeDeployment(node: NodeStatus, progress?: DeployStatus | null): DeployStatus {
  if (progress?.status === 'pending' || progress?.status === 'running') return progress;
  const base = {
    nodeId: node.nodeId,
    deploymentId: progress?.deploymentId ?? `runtime-${node.nodeId}`,
    scope: progress?.scope ?? 'all',
    step: 'verify' as const,
    startedAt: progress?.startedAt ?? 0,
  };
  const listener = listenerStatus(node);
  if (!listener.deployed) {
    return { ...base, status: 'error', message: `监听程序未部署${listener.error ? `：${listener.error}` : ''}`, progress: 10 };
  }
  if (!listener.listening) {
    return { ...base, status: 'error', message: `监听程序未成功监听${listener.error ? `：${listener.error}` : ''}`, progress: 25 };
  }
  if (node.configuredKernels.length === 0) {
    return { ...base, status: 'no_kernels', message: '暂无内核', progress: 0 };
  }

  const runtimeByType = new Map(node.kernels.map(kernel => [kernel.type, kernel]));
  const issues = node.configuredKernels.flatMap(config => {
    const runtime = runtimeByType.get(config.type);
    if (!runtime?.detected) return [`${config.type} 未部署${runtime?.error ? `：${runtime.error}` : ''}`];
    if (!runtime.monitored) return [`${config.type} 未监听`];
    if (!runtime.accessible) return [`${config.type} 监听不可访问${runtime.error ? `：${runtime.error}` : ''}`];
    return [];
  });
  if (issues.length > 0) {
    const ready = node.configuredKernels.length - issues.length;
    const progressValue = Math.round(50 + (ready / node.configuredKernels.length) * 40);
    return { ...base, status: 'error', message: `内核未就绪：${issues.join('；')}`, progress: progressValue };
  }
  return {
    ...base,
    status: 'success',
    message: `监听程序正常，${node.configuredKernels.length} 个已配置内核全部就绪`,
    progress: 100,
  };
}

interface SshTarget {
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

interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function inputObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求内容无效');
  return value as Record<string, unknown>;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function validatePrivateKey(value: string): void {
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
  readonly #subscribers = new Set<(status: DeployStatus) => void>();
  readonly #starting = new Set<string>();

  constructor(
    private readonly composition: NodeCoreComposition,
    private readonly localKernels?: LocalKernelInstaller,
  ) {}

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

  async startDeployment(nodeId: string, kernels?: unknown, scope: DeploymentScope = 'all'): Promise<{ deploymentId: string }> {
    const active = this.#progress.get(nodeId);
    if (this.#starting.has(nodeId) || active?.status === 'pending' || active?.status === 'running') {
      throw new Error(`节点 ${nodeId} 正在部署，请等待当前任务完成`);
    }
    this.#starting.add(nodeId);
    try {
      const node = await this.findNode(nodeId);
      const requested = validateNodeKernels(kernels === undefined ? node.kernels : kernels, isLocalNode(node) || scope === 'listener').map(kernel => {
        const current = node.kernels.find(item => item.type === kernel.type);
        return current?.configPath ? { ...kernel, configPath: current.configPath } : kernel;
      });
      const deploymentId = randomUUID();
      const startedAt = Date.now();
      if (isLocalNode(node)) {
        this.setProgress({ nodeId, deploymentId, scope, step: 'configure', status: 'running', message: '正在准备本机部署', progress: 5, startedAt });
        void this.runLocalDeployment(nodeId, requested, deploymentId, scope, startedAt);
        return { deploymentId };
      }
      this.setProgress({ nodeId, deploymentId, scope, step: 'connect', status: 'pending', message: '等待 SSH 连接', progress: 0, startedAt });
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
      void this.runDeployment(node, requested, deploymentId, scope, startedAt);
      return { deploymentId };
    } finally {
      this.#starting.delete(nodeId);
    }
  }

  subscribe(listener: (status: DeployStatus) => void): () => void {
    this.#subscribers.add(listener);
    return () => { this.#subscribers.delete(listener); };
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

  async agentAction(nodeId: string, action: 'start' | 'stop' | 'restart' | 'uninstall'): Promise<void> {
    const target = await this.targetForNode(nodeId);
    const ssh = await this.connect(target);
    try {
      const command = action === 'uninstall'
        ? `systemctl disable --now miobridge-agent && rm -f ${AGENT_REMOTE_PATH} ${AGENT_SERVICE_PATH} && rm -rf /etc/miobridge-agent && systemctl daemon-reload`
        : `systemctl ${action} miobridge-agent`;
      const executed = await this.execRoot(ssh, target, command);
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

  async uninstallKernel(nodeId: string, kernelType: string): Promise<KernelDetection> {
    const type = this.kernelType(kernelType);
    const target = await this.targetForNode(nodeId);
    const ssh = await this.connect(target);
    try {
      const executed = await this.execRoot(ssh, target, KERNEL_REMOVE_COMMANDS[type]);
      if (executed.code !== 0) throw new Error((executed.stderr || executed.stdout).trim() || `${type} 卸载失败`);
      return await this.detectKernel(ssh, type);
    } finally {
      ssh.end();
    }
  }

  private async runDeployment(
    node: NodeConfig,
    kernels: NodeKernelConfig[],
    deploymentId: string,
    scope: DeploymentScope,
    startedAt: number,
  ): Promise<void> {
    let target: SshTarget | undefined;
    let ssh: Client | undefined;
    const emit = (step: DeployStatus['step'], status: DeployStatus['status'], message: string, progress: number) => {
      if (this.#progress.get(node.id)?.deploymentId === deploymentId) {
        this.setProgress({ nodeId: node.id, deploymentId, scope, step, status, message, progress, startedAt });
      }
    };
    try {
      emit('connect', 'running', '正在建立 SSH 连接', 5);
      target = await this.targetForNode(node.id, kernels);
      ssh = await this.connect(target);
      emit('connect', 'running', 'SSH 连接成功', 15);

      const monitored: NodeKernelConfig[] = [];
      if (scope !== 'listener') {
        for (const [index, kernel] of kernels.entries()) {
          emit('kernel', 'running', `检查并部署 ${kernel.type} 内核`, 20 + Math.round((index / kernels.length) * 35));
          await this.ensureKernel(ssh, target, kernel);
          monitored.push(kernel);
        }
        emit('kernel', 'running', `${monitored.length} 个内核已部署`, 55);
      } else {
        monitored.push(...kernels);
      }

      if (scope !== 'kernels') {
        emit('agent', 'running', '下载并安装已校验监听程序', scope === 'listener' ? 35 : 60);
        await this.installAgentBinary(ssh, target);
      } else {
        const agent = await this.exec(ssh, `test -x ${AGENT_REMOTE_PATH}`);
        if (agent.code !== 0) throw new Error('监听程序未部署，请先部署监听程序或选择部署全部');
      }
      emit('configure', 'running', '写入监听和内核监控配置', scope === 'listener' ? 65 : 72);
      await this.configureAgent(ssh, target, monitored);

      emit('start', 'running', '启动监听程序', scope === 'listener' ? 75 : 82);
      await this.startAgent(ssh, target);
      emit('start', 'running', '监听程序已启动', 90);

      emit('verify', 'running', '验证监听端口和健康状态', 94);
      await this.verifyAgent(ssh, target);
      emit('verify', 'running', '监听程序健康检查通过，正在核验内核', 98);

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
      emit('done', 'success', `${scope === 'listener' ? '监听程序' : scope === 'kernels' ? '内核' : '监听程序和内核'}已部署到节点 ${node.name}`, 100);
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

  private async runLocalDeployment(
    nodeId: string,
    kernels: readonly NodeKernelConfig[],
    deploymentId: string,
    scope: DeploymentScope,
    startedAt: number,
  ): Promise<void> {
    try {
      if (scope !== 'listener') {
        if (!this.localKernels) throw new Error('本机内核安装器不可用');
        for (const [index, kernel] of kernels.entries()) {
          const progress = 15 + Math.round((index / Math.max(kernels.length, 1)) * 60);
          this.setProgress({
            nodeId, deploymentId, scope, step: 'kernel', status: 'running',
            message: `正在部署本机 ${kernel.type} 内核`, progress, startedAt,
          });
          const installed = await this.localKernels.ensure(kernel.type);
          this.setProgress({
            nodeId, deploymentId, scope, step: 'kernel', status: 'running',
            message: `${kernel.type} ${installed.installed ? '安装完成' : '已存在'}，正在继续部署`,
            progress: 75, startedAt,
          });
        }
      }
      this.setProgress({
        nodeId, deploymentId, scope, step: 'verify', status: 'running',
        message: '正在验证本机监听程序和内核', progress: 90, startedAt,
      });
      const cluster = await this.composition.aggregation.getClusterStatus();
      const node = cluster.nodes.find(item => item.nodeId === nodeId);
      if (!node) throw new Error(`节点 ${nodeId} 不存在`);
      const assessed = assessNodeDeployment(node, null);
      this.setProgress({ ...assessed, nodeId, deploymentId, scope, startedAt });
    } catch (error) {
      this.setProgress({
        nodeId,
        deploymentId,
        scope,
        step: 'verify',
        status: 'error',
        message: error instanceof Error ? error.message : '本机部署失败',
        progress: this.#progress.get(nodeId)?.progress ?? 5,
        startedAt,
      });
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

  private connect(target: SshTarget): Promise<Client> {
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
      client.once('ready', () => resolve(client));
      client.once('error', error => reject(new Error(`SSH 连接失败: ${error.message}`)));
      client.connect(options);
    });
  }

  private exec(ssh: Client, command: string, input?: string): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      ssh.exec(command, (error: Error | undefined, channel: ClientChannel) => {
        if (error) { reject(error); return; }
        let stdout = '';
        let stderr = '';
        channel.on('data', (data: Buffer) => { stdout += data.toString(); });
        channel.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
        channel.on('close', (code: number) => resolve({ stdout, stderr, code: code ?? -1 }));
        if (input === undefined) channel.end(); else channel.end(input);
      });
    });
  }

  private execRoot(ssh: Client, target: SshTarget, command: string): Promise<ExecResult> {
    if (target.ssh.user === 'root') return this.exec(ssh, command);
    const elevated = target.ssh.password
      ? `sudo -S -p '' bash -lc ${shellQuote(command)}`
      : `sudo -n bash -lc ${shellQuote(command)}`;
    return this.exec(ssh, elevated, target.ssh.password ? `${target.ssh.password}\n` : undefined);
  }

  private async detectKernel(ssh: Client, type: KernelType): Promise<KernelDetection> {
    try {
      const result = await this.exec(ssh, `${type} version 2>&1`);
      const output = (result.stdout || result.stderr).trim();
      const version = output.split(/\r?\n/, 1)[0];
      return result.code === 0
        ? { type, installed: true, ...(version ? { version } : {}), defaultConfigPath: DEFAULT_CONFIG_PATHS[type] }
        : { type, installed: false, defaultConfigPath: DEFAULT_CONFIG_PATHS[type], ...(output ? { error: output } : {}) };
    } catch (error) {
      return { type, installed: false, defaultConfigPath: DEFAULT_CONFIG_PATHS[type], error: error instanceof Error ? error.message : '检测失败' };
    }
  }

  private async ensureKernel(ssh: Client, target: SshTarget, kernel: NodeKernelConfig): Promise<void> {
    if ((await this.detectKernel(ssh, kernel.type)).installed) return;
    const installed = await this.execRoot(ssh, target, KERNEL_INSTALL_COMMANDS[kernel.type]);
    if (installed.code !== 0 && !/installed|success|生成配置文件|链接 \(URL\)|使用协议/.test(installed.stdout)) {
      throw new Error(`${kernel.type} 安装失败: ${(installed.stderr || installed.stdout).trim()}`);
    }
    if (!(await this.detectKernel(ssh, kernel.type)).installed) throw new Error(`${kernel.type} 安装后检测失败`);
  }

  private async installAgentBinary(ssh: Client, target: SshTarget): Promise<void> {
    const detected = await this.exec(ssh, 'uname -m');
    if (detected.code !== 0) throw new Error(`Agent 架构检测失败: ${(detected.stderr || detected.stdout).trim()}`);
    const machine = detected.stdout.trim();
    const architecture = /^(x86_64|amd64)$/.test(machine)
      ? 'x64'
      : /^(aarch64|arm64)$/.test(machine) ? 'arm64' : null;
    if (!architecture) throw new Error(`不支持的 Agent 架构: ${machine}`);
    const version = process.env.MIOBRIDGE_BUILD_VERSION ?? '1.0.0';
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
      `mkdir -p /etc/miobridge-agent /usr/local/bin && install -m 755 "$workdir/agent" ${AGENT_REMOTE_PATH}`,
    ].join('\n');
    const installed = await this.execRoot(ssh, target, `bash -c ${shellQuote(installScript)}`);
    if (installed.code !== 0) throw new Error(`Agent 安装或校验失败: ${(installed.stderr || installed.stdout).trim().slice(-600)}`);
  }

  private async configureAgent(ssh: Client, target: SshTarget, kernels: readonly NodeKernelConfig[]): Promise<void> {
    await this.writeRemoteFile(ssh, target, AGENT_CONFIG_PATH, this.agentYaml(target, kernels), 0o600);
    await this.writeRemoteFile(ssh, target, AGENT_SERVICE_PATH, this.systemdUnit(), 0o644);
  }

  private async writeRemoteFile(ssh: Client, target: SshTarget, file: string, content: string, mode: number): Promise<void> {
    const template = posix.join(posix.dirname(file), `.${posix.basename(file)}.tmp.XXXXXX`);
    const encoded = Buffer.from(content).toString('base64');
    const script = [
      'set -e',
      `tmp=$(mktemp ${shellQuote(template)})`,
      `trap 'rm -f -- "$tmp"' EXIT`,
      `printf %s ${shellQuote(encoded)} | base64 -d > "$tmp"`,
      `chmod ${mode.toString(8)} "$tmp"`,
      `mv -- "$tmp" ${shellQuote(file)}`,
      'trap - EXIT',
    ].join('\n');
    const written = await this.execRoot(ssh, target, `bash -c ${shellQuote(script)}`);
    if (written.code !== 0) throw new Error(`写入 ${file} 失败: ${(written.stderr || written.stdout).trim()}`);
  }

  private agentYaml(target: SshTarget, kernels: readonly NodeKernelConfig[]): string {
    const kernelYaml = kernels.map(kernel => [
      `  - type: ${JSON.stringify(kernel.type)}`,
      `    configPath: ${JSON.stringify(kernel.configPath ?? DEFAULT_CONFIG_PATHS[kernel.type])}`,
    ].join('\n')).join('\n');
    return `node:\n  id: ${JSON.stringify(target.nodeId)}\n  name: ${JSON.stringify(target.nodeName)}\n  secret: ${JSON.stringify(target.secret)}\nkernels:\n${kernelYaml}\nmihomo:\n  path: "/usr/local/bin/mihomo"\nport: ${target.agentPort}\n`;
  }

  private systemdUnit(): string {
    return `[Unit]\nDescription=MioBridge Agent\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=${AGENT_REMOTE_PATH}\nWorkingDirectory=/etc/miobridge-agent\nEnvironment=MIOBRIDGE_AGENT_CONFIG=${AGENT_CONFIG_PATH}\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target\n`;
  }

  private async startAgent(ssh: Client, target: SshTarget): Promise<void> {
    const started = await this.execRoot(ssh, target, 'systemctl daemon-reload && systemctl enable --now miobridge-agent && systemctl restart miobridge-agent');
    if (started.code !== 0) throw new Error(`Agent 启动失败: ${(started.stderr || started.stdout).trim()}`);
  }

  private async verifyAgent(ssh: Client, target: SshTarget): Promise<void> {
    const checked = await this.exec(ssh, `for i in 1 2 3 4 5; do code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${target.agentPort}/health || true); [ "$code" = 200 ] && exit 0; sleep 2; done; exit 1`);
    if (checked.code !== 0) throw new Error('Agent 健康检查失败');
  }

  private kernelType(value: string): KernelType {
    if (!KERNEL_TYPES.includes(value as KernelType)) throw new Error(`不支持的内核类型: ${value}`);
    return value as KernelType;
  }

  private setProgress(status: DeployStatus): void {
    this.#progress.set(status.nodeId, status);
    for (const subscriber of this.#subscribers) {
      try { subscriber(status); } catch { /* A disconnected stream must not abort deployment. */ }
    }
  }

  private cleanupProgress(): void {
    const now = Date.now();
    for (const [nodeId, status] of this.#progress) {
      if ((status.status === 'success' || status.status === 'error') && now - status.startedAt > PROGRESS_TTL_MS) {
        this.#progress.delete(nodeId);
      }
    }
  }
}
