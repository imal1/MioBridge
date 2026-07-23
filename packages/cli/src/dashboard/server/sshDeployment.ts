/**
 * `SshDeploymentService` — the `DashboardOperationsPort` facade for node
 * deployment. It owns only the stateful orchestration (whole-node progress,
 * the component-task state machine, and its persistence); all stateless
 * mechanics live in `./ssh/*`:
 *
 *   - `SshTransport`   connect / exec / privilege escalation
 *   - `NodeTargets`    node → `SshTarget` resolution + one-time credentials
 *   - `kernels` / `mihomo` / `agent`  install/detect over a live connection
 *   - `util`           pure helpers (shell quoting, validation, preflight …)
 *
 * Public method signatures are unchanged so `nodeDependencies.ts` and the
 * dashboard contract tests keep working without edits.
 */
import { randomUUID } from 'node:crypto';
import {
  KERNEL_TYPES,
  validateNodeKernels,
  type KernelType,
  type NodeConfig,
  type NodeKernelConfig,
} from '@miobridge/core';
import type { NodeCoreComposition } from '../../composition.js';
import {
  reinstallCommand,
  repairCommand,
  uninstallCommand,
  upgradeCommand,
  wrapperCommand,
} from './kernelScripts.js';
import { SshTransport } from './ssh/transport.js';
import { NodeTargets } from './ssh/targets.js';
import { detectKernel, ensureKernel } from './ssh/kernels.js';
import { detectMihomoOn, installMihomoOn, uninstallMihomoOn } from './ssh/mihomo.js';
import { agentYaml, installAgent, replaceAgentConfig, startAgent, verifyAgent } from './ssh/agent.js';
import {
  deployComponent,
  deployOperation,
  inputObject,
  kernelType,
  legacyStep,
  networkPreflight,
  shellQuote,
  userSystemctl,
} from './ssh/util.js';
import {
  AGENT_USER_BIN,
  AGENT_USER_UNIT,
  DEFAULT_CONFIG_PATHS,
  LEGACY_AGENT_PATH,
  LEGACY_AGENT_SERVICE_PATH,
  PROGRESS_TTL_MS,
  TASK_HISTORY_TTL_MS,
  type ComponentDeployStatus,
  type DeployComponent,
  type DeploymentConnection,
  type DeploymentEvent,
  type DeploymentServiceOptions,
  type DeployOptions,
  type DeployStatus,
  type KernelDetection,
  type MihomoDetection,
  type SshTarget,
} from './ssh/types.js';

export { agentRelease } from './ssh/util.js';
export type {
  ComponentDeployStatus,
  DeployComponent,
  DeployOperation,
  DeploymentEvent,
  DeployOptions,
  DeployStatus,
  ExecResult,
  DeploymentServiceOptions,
  KernelDetection,
  MihomoDetection,
} from './ssh/types.js';

export class SshDeploymentService {
  readonly #progress = new Map<string, DeployStatus>();
  readonly #componentProgress = new Map<string, ComponentDeployStatus>();
  readonly #eventCounters = new Map<string, number>();
  readonly #resumedTasks = new Set<string>();
  readonly #transport: SshTransport;
  readonly #targets: NodeTargets;

  constructor(private readonly composition: NodeCoreComposition, options: DeploymentServiceOptions = {}) {
    this.#transport = new SshTransport(options);
    this.#targets = new NodeTargets(composition);
  }

  setOneTimeCredential(nodeId: string, credential: string): void {
    this.#targets.setOneTimeCredential(nodeId, credential);
  }

  clearOneTimeCredential(nodeId: string): void {
    this.#targets.clearOneTimeCredential(nodeId);
  }

  async preflight(body: unknown): Promise<{
    hostKey: string;
    architecture: string;
    checks: Array<{ key: string; label: string; ok: boolean; detail: string }>;
  }> {
    const input = inputObject(body);
    const component = typeof input.component === 'string' ? deployComponent(input.component) : 'agent';
    const target = typeof input.nodeId === 'string'
      ? await this.#targets.forNode(input.nodeId)
      : await this.#targets.fromSsh(inputObject(input.ssh));
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
    const ssh = await this.#transport.connect(target);
    try {
      const needsUserSystemd = component === 'agent';
      const needsSystemd = component !== 'mihomo';
      const [system, architecture, disk, systemd, downloader, privilege] = await Promise.all([
        this.#transport.exec(ssh, 'uname -s'),
        this.#transport.exec(ssh, 'uname -m'),
        this.#transport.exec(ssh, "df -Pk / | awk 'NR==2 {print $4}'"),
        !needsSystemd
          ? Promise.resolve({ stdout: '', stderr: '', code: 0 })
          : needsUserSystemd
          ? this.#transport.exec(ssh, userSystemctl('show-environment'))
          : this.#transport.exec(ssh, 'command -v systemctl'),
        this.#transport.exec(ssh, 'command -v curl || command -v wget'),
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
      ? await this.#targets.forNode(input.nodeId)
      : await this.#targets.fromSsh(inputObject(input.ssh));
    const ssh = await this.#transport.connect(target);
    try {
      return await Promise.all(KERNEL_TYPES.map(type => detectKernel(this.#transport, ssh, type)));
    } finally {
      ssh.end();
    }
  }

  async startDeployment(nodeId: string, kernels?: unknown): Promise<{ deploymentId: string }> {
    const node = await this.#targets.findNode(nodeId);
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
    const component = deployComponent(componentValue);
    const operation = deployOperation(operationValue);
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
    const node = await this.#targets.findNode(nodeId);
    const target: SshTarget = {
      nodeId: node.id, nodeName: node.name, secret: node.secret,
      agentPort: node.port ?? node.agent?.port ?? 3001, kernels: node.kernels,
      ssh: { host: node.host, user: node.ssh?.user ?? 'root', port: node.ssh?.port ?? 22, authMethod: 'password', hostKey: '' },
    };
    return agentYaml(target, node.kernels);
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
    const target = await this.#targets.forNode(nodeId);
    const ssh = await this.#transport.connect(target);
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
      const userAgent = await this.#transport.exec(ssh, `test -x \"${AGENT_USER_BIN}\"`);
      const legacyAgent = await this.#transport.exec(ssh, `test -x ${shellQuote(LEGACY_AGENT_PATH)} || test -f ${shellQuote(LEGACY_AGENT_SERVICE_PATH)}`);
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
        ? await this.#transport.exec(ssh, userCommand)
        : await this.#transport.execRoot(ssh, target, legacyCommand);
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

  async installKernel(nodeId: string, kernelValue: string): Promise<KernelDetection> {
    const type = kernelType(kernelValue);
    const target = await this.#targets.forNode(nodeId);
    const ssh = await this.#transport.connect(target);
    try {
      await ensureKernel(this.#transport, ssh, target, { type });
      return await detectKernel(this.#transport, ssh, type);
    } finally {
      ssh.end();
    }
  }

  async uninstallKernel(nodeId: string, kernelValue: string, options: DeployOptions = { preserveConfig: false, preserveData: false }): Promise<KernelDetection> {
    const type = kernelType(kernelValue);
    const target = await this.#targets.forNode(nodeId);
    const ssh = await this.#transport.connect(target);
    try {
      const executed = await this.#transport.execWithPrivilegeFallback(ssh, target, uninstallCommand(type, options.preserveConfig));
      if (executed.code !== 0) throw new Error((executed.stderr || executed.stdout).trim() || `${type} 卸载失败`);
      return await detectKernel(this.#transport, ssh, type);
    } finally {
      ssh.end();
    }
  }

  async kernelAction(nodeId: string, kernelValue: string, actionValue: string): Promise<{ nodeId: string; kernelType: KernelType; status: string }> {
    const type = kernelType(kernelValue);
    const action = actionValue === 'start' || actionValue === 'stop' || actionValue === 'restart' ? actionValue : null;
    if (!action) throw new Error(`不支持的核心维护操作: ${actionValue}`);
    const target = await this.#targets.forNode(nodeId);
    const ssh = await this.#transport.connect(target);
    try {
      const executed = await this.#transport.execWithPrivilegeFallback(ssh, target, wrapperCommand(type, action));
      if (executed.code !== 0) throw new Error((executed.stderr || executed.stdout).trim() || `${type} ${action} 失败`);
      return { nodeId, kernelType: type, status: action === 'stop' ? 'stopped' : 'running' };
    } finally { ssh.end(); }
  }

  async detectMihomo(nodeId: string): Promise<MihomoDetection> {
    const target = await this.#targets.forNode(nodeId);
    const ssh = await this.#transport.connect(target);
    try { return await detectMihomoOn(this.#transport, ssh); }
    finally { ssh.end(); }
  }

  async installMihomo(nodeId: string): Promise<MihomoDetection> {
    const target = await this.#targets.forNode(nodeId);
    const ssh = await this.#transport.connect(target);
    try { return await installMihomoOn(this.#transport, ssh); }
    finally { ssh.end(); }
  }

  async uninstallMihomo(nodeId: string): Promise<MihomoDetection> {
    const target = await this.#targets.forNode(nodeId);
    const ssh = await this.#transport.connect(target);
    try { return await uninstallMihomoOn(this.#transport, ssh, target); }
    finally { ssh.end(); }
  }

  private async runComponentDeployment(taskId: string): Promise<void> {
    const initial = await this.requireComponentDeployment(taskId);
    const { nodeId, component, operation, options } = initial;
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
      await this.#targets.findNode(nodeId);
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
        const node = await this.#targets.findNode(nodeId);
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
        const node = await this.#targets.findNode(nodeId);
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
    } finally {
      this.clearOneTimeCredential(nodeId);
    }
  }

  private async componentVersion(nodeId: string, component: DeployComponent): Promise<string | undefined> {
    if (component === 'agent') return (await this.#targets.findNode(nodeId)).agent?.version || undefined;
    if (component === 'mihomo') return (await this.detectMihomo(nodeId)).version;
    return (await this.detect({ nodeId })).find(item => item.type === component)?.version;
  }

  private async repairKernel(nodeId: string, type: KernelType): Promise<KernelDetection> {
    const target = await this.#targets.forNode(nodeId);
    const ssh = await this.#transport.connect(target);
    try {
      await ensureKernel(this.#transport, ssh, target, { type });
      const repaired = await this.#transport.execWithPrivilegeFallback(ssh, target, repairCommand(type));
      if (repaired.code !== 0) throw new Error((repaired.stderr || repaired.stdout).trim() || `${type} 修复检查失败`);
      return await detectKernel(this.#transport, ssh, type);
    } finally { ssh.end(); }
  }

  private async upgradeKernel(nodeId: string, type: KernelType): Promise<KernelDetection> {
    const target = await this.#targets.forNode(nodeId);
    const ssh = await this.#transport.connect(target);
    try {
      await ensureKernel(this.#transport, ssh, target, { type });
      const upgraded = await this.#transport.execWithPrivilegeFallback(ssh, target, upgradeCommand(type));
      if (upgraded.code !== 0) throw new Error((upgraded.stderr || upgraded.stdout).trim() || `${type} 升级失败`);
      return await detectKernel(this.#transport, ssh, type);
    } finally { ssh.end(); }
  }

  private async reinstallKernel(nodeId: string, type: KernelType, options: DeployOptions): Promise<KernelDetection> {
    const target = await this.#targets.forNode(nodeId);
    const ssh = await this.#transport.connect(target);
    try {
      const reinstalled = await this.#transport.execWithPrivilegeFallback(ssh, target, reinstallCommand(type, options.preserveConfig));
      if (reinstalled.code !== 0) throw new Error((reinstalled.stderr || reinstalled.stdout).trim() || `${type} 重装失败`);
      return await detectKernel(this.#transport, ssh, type);
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
    const node = await this.#targets.findNode(nodeId);
    if (!node.agent?.deployed) throw new Error('请先部署 Agent，再配置监控内核');
    const target = await this.#targets.forNode(nodeId, kernels);
    const ssh = await this.#transport.connect(target);
    let replaced = false;
    try {
      for (const kernel of kernels) {
        const path = kernel.configPath ?? DEFAULT_CONFIG_PATHS[kernel.type];
        const checked = await this.#transport.exec(ssh, `test -r ${shellQuote(path)}`);
        if (checked.code !== 0) throw new Error(`${kernel.type} 监控路径不可读: ${path}`);
      }
      replaced = await replaceAgentConfig(this.#transport, ssh, agentYaml(target, kernels));
      await startAgent(this.#transport, ssh);
      await verifyAgent(this.#transport, ssh, target);
      const updated = await this.composition.repository.update(nodeId, current => ({
        ...current,
        kernels: [...kernels],
        ...(current.ssh ? { ssh: { ...current.ssh, hostKey: target.ssh.hostKey } } : {}),
        ...(current.agent ? { agent: { ...current.agent, status: 'running' as const } } : {}),
      }));
      await this.#transport.exec(ssh, 'rm -f "$HOME/.config/miobridge-agent/agent.yaml.rollback"');
      return updated;
    } catch (error) {
      if (replaced) {
        await this.#transport.exec(ssh, `if [ -f "$HOME/.config/miobridge-agent/agent.yaml.rollback" ]; then cp "$HOME/.config/miobridge-agent/agent.yaml.rollback" "$HOME/.config/miobridge-agent/agent.yaml"; ${userSystemctl('restart', 'miobridge-agent.service')} || true; else rm -f "$HOME/.config/miobridge-agent/agent.yaml"; ${userSystemctl('stop', 'miobridge-agent.service')} || true; fi`).catch(() => undefined);
      }
      throw error;
    } finally {
      ssh.end();
    }
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
      target = await this.#targets.forNode(node.id, kernels);
      ssh = await this.#transport.connect(target);
      emit('connect', 'success', 'SSH 连接成功', 15);

      const monitored: NodeKernelConfig[] = [];
      for (const kernel of kernels) {
        emit('kernel', 'running', `检查 ${kernel.type} 内核`, 25);
        const detected = await detectKernel(this.#transport, ssh, kernel.type);
        const configPath = kernel.configPath ?? detected.defaultConfigPath;
        const readable = detected.installed ? await this.#transport.exec(ssh, `test -r ${shellQuote(configPath)}`) : { code: 1 };
        if (detected.installed && readable.code === 0) monitored.push({ ...kernel, configPath });
      }
      emit('kernel', 'success', `${monitored.length} 个已安装且可读的内核将由 Agent 监控；未安装内核不会自动安装`, 50);

      emit('agent', 'running', '下载并安装已校验 Agent', 60);
      await installAgent(this.#transport, ssh, target, monitored);
      emit('agent', 'success', 'Agent 已安装', 80);

      emit('start', 'running', '启动 Agent 服务', 85);
      await startAgent(this.#transport, ssh);
      emit('start', 'success', 'Agent 已启动', 92);

      emit('verify', 'running', '验证 Agent 健康状态', 95);
      await verifyAgent(this.#transport, ssh, target);
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
      this.clearOneTimeCredential(node.id);
    }
  }

  private async completeNode(nodeId: string, deploymentId: string, update: (node: NodeConfig) => NodeConfig): Promise<void> {
    await this.composition.repository.update(nodeId, node => node.agent?.deploymentId === deploymentId ? update(node) : node);
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
