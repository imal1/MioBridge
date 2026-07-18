import type { DashboardOperationsPort, OperationsResult } from '@miobridge/cli';
import type {
  FixtureDeploymentEvent,
  FixtureDeploymentTask,
  FixtureKernelConfig,
  FixtureNode,
  HarnessState,
} from './state.js';

const KERNEL_TYPES = ['sing-box', 'xray', 'v2ray'] as const;
const COMPONENTS = ['agent', 'mihomo', ...KERNEL_TYPES] as const;
const OPERATIONS = ['install', 'reinstall', 'upgrade', 'repair', 'uninstall'] as const;

type KernelType = typeof KERNEL_TYPES[number];
type DeployComponent = typeof COMPONENTS[number];
type DeployOperation = typeof OPERATIONS[number];

function timestamp(): string {
  return new Date().toISOString();
}

function ok<T>(data: T): OperationsResult<T> {
  return { success: true, data, timestamp: timestamp() };
}

function inputObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求内容无效');
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`缺少字段: ${field}`);
  return value.trim();
}

function nodeById(state: HarnessState, nodeId: string): FixtureNode {
  const node = state.nodes.find(candidate => candidate.nodeId === nodeId || candidate.id === nodeId);
  if (!node) throw new Error(`节点 ${nodeId} 不存在`);
  return node;
}

function publicNode(node: FixtureNode): FixtureNode {
  return structuredClone(node);
}

function validateKernelConfigs(value: unknown): FixtureKernelConfig[] {
  if (!Array.isArray(value)) throw new Error('运行时监控配置必须是数组');
  const seen = new Set<KernelType>();
  return value.map((candidate, index) => {
    const item = inputObject(candidate);
    const type = requiredString(item.type, `kernels.${index}.type`) as KernelType;
    if (!KERNEL_TYPES.includes(type)) throw new Error(`不支持的协议核心: ${type}`);
    if (seen.has(type)) throw new Error(`协议核心不能重复: ${type}`);
    seen.add(type);
    if (item.configPath !== undefined && (typeof item.configPath !== 'string' || !item.configPath.startsWith('/'))) {
      throw new Error(`${type} 配置路径必须是绝对路径`);
    }
    return { type, ...(typeof item.configPath === 'string' ? { configPath: item.configPath } : {}) };
  });
}

function preflightChecks(failure?: string) {
  const checks = [
    ['dns', 'DNS 解析', 'ready-node.e2e.invalid → 192.0.2.10'],
    ['tcp', 'TCP 连接', '22/tcp 可达'],
    ['ssh', 'SSH 认证', '连接与认证成功'],
    ['system', 'Linux 系统', 'Linux'],
    ['architecture', 'CPU 架构', 'x86_64'],
    ['disk', '磁盘空间', '2048 MiB 可用'],
    ['systemd', 'systemd', '/usr/bin/systemctl'],
    ['download', '下载工具', '/usr/bin/curl'],
    ['privilege', '管理员权限', 'root/sudo 可用'],
  ] as const;
  return checks.map(([key, label, detail]) => ({
    key,
    label,
    ok: failure !== key,
    detail: failure === key ? `${label}失败（E2E fixture）` : detail,
  }));
}

function detectionFor(node: FixtureNode, type: KernelType) {
  const runtime = node.kernels.find(candidate => candidate.type === type);
  const defaultConfigPath = `/etc/${type}/config.json`;
  return {
    type,
    installed: runtime?.detected === true,
    ...(runtime?.version ? { version: runtime.version } : {}),
    defaultConfigPath,
    ...(runtime?.error ? { error: runtime.error } : {}),
  };
}

function componentVersion(node: FixtureNode, component: DeployComponent): string | undefined {
  if (component === 'agent') return node.agent.version || undefined;
  if (component === 'mihomo') return node.mihomoVersion;
  return node.kernels.find(kernel => kernel.type === component)?.version;
}

function componentInstalled(node: FixtureNode, component: DeployComponent): boolean {
  if (component === 'agent') return node.agent.deployed;
  if (component === 'mihomo') return node.mihomoAvailable === true;
  return node.kernels.find(kernel => kernel.type === component)?.detected === true;
}

function applyComponentResult(node: FixtureNode, task: FixtureDeploymentTask): void {
  const installed = task.operation !== 'uninstall';
  if (task.component === 'agent') {
    node.agent = installed
      ? { ...node.agent, deployed: true, status: 'running', version: '1.0.1-e2e', lastDeploy: timestamp(), port: 3001, deploymentId: task.taskId }
      : { deployed: false, status: 'not_deployed', version: '', lastDeploy: timestamp() };
    node.online = installed;
    return;
  }
  if (task.component === 'mihomo') {
    node.mihomoAvailable = installed;
    if (installed) node.mihomoVersion = 'v1.20.0-e2e';
    else delete node.mihomoVersion;
    return;
  }
  const runtime = node.kernels.find(kernel => kernel.type === task.component);
  if (!runtime) return;
  runtime.detected = installed;
  runtime.accessible = installed;
  if (installed) {
    runtime.version = `${task.component}-e2e-current`;
    if (node.agent.deployed && !node.configuredKernels.some(kernel => kernel.type === task.component)) {
      const configPath = `/etc/${task.component}/config.json`;
      node.configuredKernels.push({ type: task.component, configPath });
      runtime.monitored = true;
      runtime.configPaths = [configPath];
    }
  }
  else delete runtime.version;
  if (!installed) {
    runtime.monitored = false;
    runtime.nodesCount = 0;
    runtime.configPaths = [];
    node.configuredKernels = node.configuredKernels.filter(kernel => kernel.type !== task.component);
  }
}

function nextId(state: HarnessState, prefix: string): string {
  state.sequence += 1;
  return `${prefix}-${String(state.sequence).padStart(4, '0')}`;
}

export function createOperations(state: HarnessState): DashboardOperationsPort {
  const eventFor = (task: FixtureDeploymentTask): FixtureDeploymentEvent => {
    const events = state.events.get(task.taskId) ?? [];
    const event: FixtureDeploymentEvent = {
      eventId: String(events.length + 1).padStart(8, '0'),
      taskId: task.taskId,
      nodeId: task.nodeId,
      component: task.component,
      status: task.status,
      step: task.step,
      progress: task.progress,
      message: task.message,
      timestamp: timestamp(),
    };
    events.push(event);
    state.events.set(task.taskId, events);
    return event;
  };

  const patchTask = (taskId: string, patch: Partial<FixtureDeploymentTask>): FixtureDeploymentTask => {
    const current = state.tasks.get(taskId);
    if (!current) throw new Error(`部署任务 ${taskId} 不存在`);
    Object.assign(current, patch);
    eventFor(current);
    return current;
  };

  const schedule = (handler: () => void, delay = 20): void => {
    const timer = setTimeout(() => {
      state.timers.delete(timer);
      handler();
    }, delay);
    state.timers.add(timer);
  };

  const controlRequestCount = () => state.requests.filter(request => request.path.startsWith('/__e2e__/control')).length;

  const finishTask = (taskId: string): void => {
    const task = state.tasks.get(taskId);
    if (!task || ['success', 'error', 'cancelled'].includes(task.status)) return;
    if (state.controls.deploymentOutcome === 'error') {
      patchTask(taskId, {
        status: 'error', step: 'done', progress: 100,
        message: `${task.component} ${task.operation} 失败（E2E fixture）`,
        errorCode: 'FIXTURE_DEPLOYMENT_FAILED', finishedAt: Date.now(),
      });
      return;
    }
    const node = nodeById(state, task.nodeId);
    applyComponentResult(node, task);
    const afterVersion = componentVersion(node, task.component);
    patchTask(taskId, {
      status: 'success', step: 'done', progress: 100,
      message: `${task.component} ${task.operation} 已完成并通过验证`,
      ...(afterVersion ? { afterVersion } : {}), finishedAt: Date.now(),
    });
  };

  const afterInstalling = (taskId: string): void => {
    const task = state.tasks.get(taskId);
    if (!task || ['success', 'error', 'cancelled'].includes(task.status)) return;
    const node = nodeById(state, task.nodeId);
    const isKernel = KERNEL_TYPES.includes(task.component as KernelType);
    const configured = isKernel && node.configuredKernels.some(kernel => kernel.type === task.component);
    const needsConfiguring = isKernel && node.agent.deployed
      && (task.operation === 'uninstall' ? configured : !configured);
    if (needsConfiguring) {
      patchTask(taskId, {
        status: 'running', step: 'configuring', progress: task.operation === 'uninstall' ? 72 : 78,
        message: task.operation === 'uninstall'
          ? `从 Agent 监控中移除 ${task.component}`
          : `将 ${task.component} 加入 Agent 监控`,
      });
    }
    schedule(() => {
      const current = state.tasks.get(taskId);
      if (!current || ['success', 'error', 'cancelled'].includes(current.status)) return;
      patchTask(taskId, {
        status: 'running', step: 'postchecking', progress: 92,
        message: '验证安装结果与运行状态',
      });
      schedule(() => finishTask(taskId), 30);
    });
  };

  const enterInstalling = (taskId: string): void => {
    const task = state.tasks.get(taskId);
    if (!task || ['success', 'error', 'cancelled'].includes(task.status)) return;
    patchTask(taskId, {
      status: 'running', step: 'installing', progress: task.operation === 'uninstall' ? 45 : 55,
      message: task.operation === 'uninstall'
        ? `卸载 ${task.component}`
        : task.operation === 'repair'
          ? `修复 ${task.component}`
          : task.operation === 'upgrade'
            ? `升级 ${task.component}`
            : task.operation === 'reinstall'
              ? `重装 ${task.component}`
              : `安装 ${task.component}`,
    });
    if (state.controls.deploymentHoldAt === 'installing') waitForHoldRelease(taskId, 'installing');
    else schedule(() => afterInstalling(taskId));
  };

  const afterPrechecking = (taskId: string): void => {
    const task = state.tasks.get(taskId);
    if (!task || ['success', 'error', 'cancelled'].includes(task.status)) return;
    if (task.operation !== 'uninstall' && (task.component === 'agent' || task.component === 'mihomo')) {
      patchTask(taskId, {
        status: 'running', step: 'downloading', progress: task.component === 'agent' ? 30 : 35,
        message: task.component === 'agent'
          ? '下载并校验 Agent 发布包'
          : '下载、校验并原子安装 mihomo',
      });
      if (task.component === 'mihomo') schedule(() => afterInstalling(taskId));
      else schedule(() => enterInstalling(taskId));
      return;
    }
    schedule(() => enterInstalling(taskId));
  };

  const waitForHoldRelease = (taskId: string, hold: 'prechecking' | 'installing'): void => {
    const controlsAtHold = controlRequestCount();
    const poll = () => {
      const task = state.tasks.get(taskId);
      if (!task || ['success', 'error', 'cancelled'].includes(task.status)) return;
      const receivedAnotherControl = controlRequestCount() > controlsAtHold;
      if (state.controls.deploymentHoldAt === hold && !receivedAnotherControl) {
        schedule(poll, 25);
        return;
      }
      if (hold === 'prechecking') {
        afterPrechecking(taskId);
      } else {
        afterInstalling(taskId);
      }
    };
    schedule(poll, 25);
  };

  const advanceTask = (taskId: string): void => {
    const task = state.tasks.get(taskId);
    if (!task || task.status !== 'pending' || state.controls.deploymentHoldAt === 'queued') return;
    const node = nodeById(state, task.nodeId);
    const beforeVersion = componentVersion(node, task.component);
    patchTask(taskId, {
      status: 'running', step: 'prechecking', progress: 10,
      message: '检查 SSH、架构与目标状态',
      ...(beforeVersion ? { beforeVersion } : {}),
    });
    if (state.controls.deploymentHoldAt === 'prechecking') {
      waitForHoldRelease(taskId, 'prechecking');
      return;
    }
    schedule(() => afterPrechecking(taskId));
  };

  const startTask = (
    nodeId: string,
    componentValue: string,
    operationValue: string,
    input: { idempotencyKey?: string; options?: { preserveConfig?: boolean; preserveData?: boolean }; retryOf?: string } = {},
  ): { taskId: string } => {
    const node = nodeById(state, nodeId);
    const component = componentValue as DeployComponent;
    const operation = operationValue as DeployOperation;
    if (!COMPONENTS.includes(component)) throw new Error(`不支持的部署组件: ${componentValue}`);
    if (!OPERATIONS.includes(operation)) throw new Error(`不支持的部署操作: ${operationValue}`);
    const idempotencyKey = input.idempotencyKey?.trim() || nextId(state, 'idempotency');
    const duplicate = state.idempotency.get(idempotencyKey);
    if (duplicate) return { taskId: duplicate };
    const active = [...state.tasks.values()].filter(task => task.nodeId === nodeId && (task.status === 'pending' || task.status === 'running'));
    const sameComponent = active.find(task => task.component === component);
    if (sameComponent) throw new Error(`${nodeId} 的 ${component} 已有进行中的任务 ${sameComponent.taskId}`);
    const uninstallConflict = active.find(task => task.component === 'agent' && task.operation === 'uninstall');
    if (uninstallConflict || (component === 'agent' && operation === 'uninstall' && active.length > 0)) {
      throw new Error(`Agent 卸载与节点 ${nodeId} 的其他部署任务互斥`);
    }
    const taskId = nextId(state, 'deployment');
    const startedAt = Date.now();
    const task: FixtureDeploymentTask = {
      taskId, idempotencyKey, nodeId: node.nodeId, component, operation,
      step: 'queued', status: 'pending', message: '任务已进入部署队列', progress: 0,
      actorRole: 'admin',
      options: {
        preserveConfig: input.options?.preserveConfig !== false,
        preserveData: input.options?.preserveData !== false,
      },
      createdAt: new Date(startedAt).toISOString(), startedAt,
      ...(input.retryOf ? { retryOf: input.retryOf } : {}),
    };
    state.tasks.set(taskId, task);
    state.idempotency.set(idempotencyKey, taskId);
    eventFor(task);
    if (state.controls.deploymentHoldAt !== 'queued') schedule(() => advanceTask(taskId));
    return { taskId };
  };

  return {
    async getClusterStatus() {
      const enabled = state.nodes.filter(node => node.enabled);
      return ok({
        totalNodes: state.nodes.length,
        onlineNodes: enabled.filter(node => node.online).length,
        totalProxies: enabled.reduce((total, node) => total + (node.nodesCount ?? 0), 0),
        nodes: state.nodes.map(publicNode),
        lastUpdated: timestamp(),
      });
    },

    async getClusterHealth(nodeId) {
      if (nodeId) return ok(publicNode(nodeById(state, nodeId)));
      const enabled = state.nodes.filter(node => node.enabled);
      return ok({
        totalNodes: state.nodes.length,
        onlineNodes: enabled.filter(node => node.online).length,
        healthy: enabled.every(node => !node.agent.deployed || node.online),
        nodes: state.nodes.map(publicNode),
      });
    },

    async triggerClusterUpdate(nodeId) {
      if (nodeId) nodeById(state, nodeId);
      return ok({ updated: nodeId ? 1 : state.nodes.length, nodeId: nodeId ?? null });
    },

    async addNode(body) {
      const input = inputObject(body);
      const name = requiredString(input.name, 'name');
      const host = requiredString(input.host, 'host');
      const location = requiredString(input.location, 'location');
      const sshUser = requiredString(input.sshUser, 'sshUser');
      const authMethod = input.sshAuthMethod === 'privateKey' ? 'privateKey' : 'password';
      const credential = authMethod === 'privateKey' ? input.sshPrivateKey : input.sshPassword;
      if (typeof credential !== 'string' || !credential) throw new Error('缺少 SSH 凭据');
      if (state.nodes.some(node => node.host === host)) throw new Error('该主机已存在');
      const sshPort = input.sshPort === undefined ? 22 : Number(input.sshPort);
      if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) throw new Error('SSH 端口无效');
      const tags = Array.isArray(input.tags)
        ? [...new Set(input.tags.map(tag => requiredString(tag, 'tags')).slice(0, 20))]
        : [];
      const id = nextId(state, 'node');
      const hostKey = typeof input.sshHostKey === 'string' ? input.sshHostKey : '';
      const node: FixtureNode = {
        id, nodeId: id, name, host, location, enabled: true, tags,
        sshUser, sshPort, sshHostKey: hostKey,
        ssh: { user: sshUser, port: sshPort, authMethod, hostKey },
        configuredKernels: validateKernelConfigs(input.kernels ?? []),
        kernels: KERNEL_TYPES.map(type => ({ type, detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] })),
        online: false, mihomoAvailable: false,
        agent: { deployed: false, version: '', status: 'not_deployed', lastDeploy: '' },
      };
      state.nodes.push(node);
      return { ...ok(publicNode(node)), statusCode: 201 };
    },

    async preflightNode(body) {
      const input = inputObject(body);
      if (typeof input.nodeId === 'string') nodeById(state, input.nodeId);
      else {
        const ssh = inputObject(input.ssh);
        requiredString(ssh.host, 'ssh.host');
        requiredString(ssh.user, 'ssh.user');
      }
      const checks = preflightChecks(state.controls.nodePreflightFailure);
      return ok({
        hostKey: 'SHA256:e2e-confirmed-host-key',
        architecture: checks.every(check => check.ok) ? 'x86_64' : '',
        checks,
      });
    },

    async updateNode(nodeId, body) {
      const node = nodeById(state, nodeId);
      const input = inputObject(body);
      if (state.controls.nodeUpdateFailure === true) {
        return { success: false, error: '节点更新失败（E2E fixture）', statusCode: 409, timestamp: timestamp() };
      }
      const nextHost = input.host === undefined ? node.host : requiredString(input.host, 'host');
      if (state.nodes.some(candidate => candidate.nodeId !== node.nodeId && candidate.host === nextHost)) throw new Error('该主机已存在');
      if (input.name !== undefined) node.name = requiredString(input.name, 'name');
      if (input.location !== undefined) node.location = requiredString(input.location, 'location');
      if (input.tags !== undefined) {
        if (!Array.isArray(input.tags)) throw new Error('节点标签必须是数组');
        node.tags = [...new Set(input.tags.map(tag => requiredString(tag, 'tags')).slice(0, 20))];
      }
      if (input.enabled !== undefined) node.enabled = Boolean(input.enabled);
      if (nextHost !== node.host) {
        node.host = nextHost;
        node.sshHostKey = '';
        if (node.ssh) node.ssh.hostKey = '';
      }
      if (input.sshUser !== undefined) {
        node.sshUser = requiredString(input.sshUser, 'sshUser');
        if (node.ssh) node.ssh.user = node.sshUser;
      }
      if (input.sshPort !== undefined) {
        const port = Number(input.sshPort);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 端口无效');
        node.sshPort = port;
        if (node.ssh) node.ssh.port = port;
      }
      return ok(publicNode(node));
    },

    async deleteNode(nodeId, force = false) {
      const node = nodeById(state, nodeId);
      if (node.agent.deployed && !force) throw new Error('节点仍安装 Agent，请先在部署中心卸载');
      state.nodes = state.nodes.filter(candidate => candidate.nodeId !== node.nodeId);
      return ok({ nodeId, deleted: true });
    },

    async updateNodeKernels(nodeId, kernels) {
      const node = nodeById(state, nodeId);
      if (state.controls.monitoringFailure) throw new Error('Agent 监控配置验证失败（E2E fixture）');
      const validated = validateKernelConfigs(kernels);
      node.configuredKernels = validated;
      for (const runtime of node.kernels) {
        const monitored = validated.find(kernel => kernel.type === runtime.type);
        runtime.monitored = Boolean(monitored);
        runtime.configPaths = monitored ? [monitored.configPath ?? `/etc/${runtime.type}/config.json`] : [];
      }
      return ok(publicNode(node));
    },

    async restartAgent(nodeId) {
      const node = nodeById(state, nodeId);
      if (state.controls.agentFailure) throw new Error('Agent 操作失败（E2E fixture）');
      if (!node.agent.deployed) throw new Error('Agent 尚未安装');
      node.agent.status = 'running'; node.online = true;
      return ok({ nodeId, status: 'running' });
    },

    async startAgent(nodeId) {
      const node = nodeById(state, nodeId);
      if (state.controls.agentFailure) throw new Error('Agent 操作失败（E2E fixture）');
      if (!node.agent.deployed) throw new Error('Agent 尚未安装');
      node.agent.status = 'running'; node.online = true;
      return ok({ nodeId, status: 'running' });
    },

    async stopAgent(nodeId) {
      const node = nodeById(state, nodeId);
      if (state.controls.agentFailure) throw new Error('Agent 操作失败（E2E fixture）');
      if (!node.agent.deployed) throw new Error('Agent 尚未安装');
      node.agent.status = 'stopped'; node.online = false;
      return ok({ nodeId, status: 'stopped' });
    },

    async uninstallAgent(nodeId) {
      const node = nodeById(state, nodeId);
      if (state.controls.agentFailure) throw new Error('Agent 操作失败（E2E fixture）');
      node.agent = { deployed: false, version: '', status: 'not_deployed', lastDeploy: timestamp() };
      node.online = false;
      return ok({ nodeId, status: 'not_deployed' });
    },

    async updateAgent(nodeId) {
      const node = nodeById(state, nodeId);
      if (state.controls.agentFailure) throw new Error('Agent 操作失败（E2E fixture）');
      if (!node.agent.deployed) throw new Error('Agent 尚未安装');
      node.agent.version = '1.0.1-e2e';
      return ok({ nodeId, version: node.agent.version });
    },

    async detectKernels(body) {
      const input = inputObject(body);
      const node = typeof input.nodeId === 'string'
        ? nodeById(state, input.nodeId)
        : nodeById(state, 'node-ready');
      if (state.controls.kernelFailure) throw new Error('运行时检测失败（E2E fixture）');
      return ok(KERNEL_TYPES.map(type => detectionFor(node, type)));
    },

    async installKernel(nodeId, kernelType) {
      const node = nodeById(state, nodeId);
      if (state.controls.kernelFailure) throw new Error('协议核心安装失败（E2E fixture）');
      const type = kernelType as KernelType;
      if (!KERNEL_TYPES.includes(type)) throw new Error(`不支持的协议核心: ${kernelType}`);
      const runtime = node.kernels.find(item => item.type === type)!;
      runtime.detected = true; runtime.accessible = true; runtime.version = `${type}-e2e-current`;
      return ok(detectionFor(node, type));
    },

    async uninstallKernel(nodeId, kernelType) {
      const node = nodeById(state, nodeId);
      if (state.controls.kernelFailure) throw new Error('协议核心卸载失败（E2E fixture）');
      const type = kernelType as KernelType;
      if (!KERNEL_TYPES.includes(type)) throw new Error(`不支持的协议核心: ${kernelType}`);
      const runtime = node.kernels.find(item => item.type === type)!;
      runtime.detected = false; runtime.monitored = false; runtime.accessible = false; runtime.nodesCount = 0; runtime.configPaths = [];
      node.configuredKernels = node.configuredKernels.filter(item => item.type !== type);
      return ok(detectionFor(node, type));
    },

    async kernelAction(nodeId, kernelType, action) {
      const node = nodeById(state, nodeId);
      if (state.controls.kernelFailure) throw new Error('协议核心维护失败（E2E fixture）');
      const type = kernelType as KernelType;
      if (!KERNEL_TYPES.includes(type) || !['start', 'stop', 'restart'].includes(action)) throw new Error('运行时维护参数无效');
      const runtime = node.kernels.find(item => item.type === type)!;
      if (!runtime.detected) throw new Error(`${type} 尚未安装`);
      runtime.accessible = action !== 'stop';
      return ok({ nodeId, kernelType: type, status: action === 'stop' ? 'stopped' : 'running' });
    },

    async deployToNode(nodeId, kernels) {
      if (kernels !== undefined) validateKernelConfigs(kernels);
      const created = startTask(nodeId, 'agent', 'install');
      return ok({ deploymentId: created.taskId });
    },

    async getDeployProgress(nodeId) {
      const task = [...state.tasks.values()].reverse().find(candidate => candidate.nodeId === nodeId);
      if (!task) return ok(null);
      return ok({
        nodeId: task.nodeId,
        deploymentId: task.taskId,
        step: task.step,
        status: task.status === 'cancelled' ? 'error' : task.status,
        message: task.message,
        progress: task.progress,
        startedAt: task.startedAt,
      });
    },

    async getAllDeployStatuses(nodeIds) {
      const allowed = nodeIds ? new Set(nodeIds) : null;
      const deployments: Record<string, unknown> = {};
      for (const node of state.nodes) {
        if (allowed && !allowed.has(node.nodeId)) continue;
        const task = [...state.tasks.values()].reverse().find(candidate => candidate.nodeId === node.nodeId);
        if (!task) continue;
        deployments[node.nodeId] = {
          nodeId: node.nodeId, deploymentId: task.taskId, step: task.step,
          status: task.status === 'cancelled' ? 'error' : task.status,
          message: task.message, progress: task.progress, startedAt: task.startedAt,
        };
      }
      return ok({ deployments });
    },

    async startComponentDeployment(nodeId, component, operation, input) {
      return ok(startTask(nodeId, component, operation, input));
    },

    async getComponentDeployments(nodeIds) {
      const allowed = nodeIds ? new Set(nodeIds) : null;
      return ok({
        deployments: Object.fromEntries([...state.tasks].filter(([, task]) => !allowed || allowed.has(task.nodeId))),
      });
    },

    async getComponentDeployment(taskId) {
      return ok(state.tasks.get(taskId) ?? null);
    },

    async cancelComponentDeployment(taskId) {
      const task = state.tasks.get(taskId);
      if (!task) throw new Error(`部署任务 ${taskId} 不存在`);
      if (task.status !== 'pending' && !(task.status === 'running' && task.step === 'prechecking')) {
        throw new Error('任务仅能在排队或预检阶段取消');
      }
      return ok(patchTask(taskId, {
        status: 'cancelled', step: 'done', message: '任务已取消，未继续执行远端写入', finishedAt: Date.now(),
      }));
    },

    async retryComponentDeployment(taskId) {
      const task = state.tasks.get(taskId);
      if (!task) throw new Error(`部署任务 ${taskId} 不存在`);
      if (task.status !== 'error' && task.status !== 'cancelled') throw new Error('只有失败或已取消任务可以重试');
      return ok(startTask(task.nodeId, task.component, task.operation, {
        options: task.options,
        retryOf: task.taskId,
        idempotencyKey: nextId(state, 'retry'),
      }));
    },

    async getDeploymentEvents(taskId, afterEventId) {
      if (!state.tasks.has(taskId)) throw new Error(`部署任务 ${taskId} 不存在`);
      const events = state.events.get(taskId) ?? [];
      return ok({ events: afterEventId ? events.filter(event => event.eventId > afterEventId) : events });
    },

    async getDeploymentLog(taskId) {
      if (!state.tasks.has(taskId)) throw new Error(`部署任务 ${taskId} 不存在`);
      const content = (state.events.get(taskId) ?? []).map(event =>
        `${event.timestamp} ${event.status.toUpperCase()} ${event.step} ${event.message}`).join('\n');
      return ok({ taskId, content });
    },

    async getManualAgentConfig(nodeId) {
      const node = nodeById(state, nodeId);
      state.downloadedManualConfigs += 1;
      const content = [
        'node:',
        `  id: ${node.nodeId}`,
        `  name: ${JSON.stringify(node.name)}`,
        `  secret: fixture-secret-${node.nodeId}`,
        `  port: ${node.agent.port ?? 3001}`,
        'controlPlane:',
        `  url: ${state.origin}`,
        'kernels:',
        ...node.configuredKernels.flatMap(kernel => [
          `  - type: ${kernel.type}`,
          `    configPath: ${kernel.configPath ?? `/etc/${kernel.type}/config.json`}`,
        ]),
        '',
      ].join('\n');
      return ok({ nodeId, content });
    },

    async getComponentStates(nodeIds) {
      const allowed = nodeIds ? new Set(nodeIds) : null;
      const states = state.nodes.filter(node => !allowed || allowed.has(node.nodeId)).flatMap(node =>
        COMPONENTS.map(component => {
          const latest = [...state.tasks.values()].reverse().find(task => task.nodeId === node.nodeId && task.component === component);
          let installState: string;
          if (latest?.status === 'error') installState = 'failed';
          else if (latest && (latest.status === 'pending' || latest.status === 'running')) {
            installState = latest.operation === 'uninstall' ? 'uninstalling' : latest.operation === 'upgrade' ? 'upgrading' : 'installing';
          } else installState = componentInstalled(node, component) ? 'installed' : 'not_installed';
          if (component === 'agent') return {
            nodeId: node.nodeId, component, installState,
            runtimeState: !node.agent.deployed ? 'not_applicable' : node.agent.status === 'running' ? 'running' : node.agent.status === 'stopped' ? 'stopped' : 'error',
            monitorState: 'not_applicable',
            ...(node.agent.version ? { version: node.agent.version } : {}),
            ...(latest ? { lastTaskId: latest.taskId } : {}),
          };
          if (component === 'mihomo') return {
            nodeId: node.nodeId, component, installState, runtimeState: 'not_applicable', monitorState: 'not_applicable',
            path: '/usr/local/bin/mihomo', ...(node.mihomoVersion ? { version: node.mihomoVersion } : {}),
            ...(latest ? { lastTaskId: latest.taskId } : {}),
          };
          const runtime = node.kernels.find(kernel => kernel.type === component)!;
          const monitored = node.configuredKernels.find(kernel => kernel.type === component);
          return {
            nodeId: node.nodeId, component, installState,
            runtimeState: !runtime.detected ? 'not_applicable' : runtime.accessible ? 'running' : 'stopped',
            monitorState: runtime.monitored ? 'monitored' : 'unmonitored',
            ...(runtime.version ? { version: runtime.version } : {}),
            ...(monitored?.configPath ? { configPath: monitored.configPath } : {}),
            sources: runtime.nodesCount,
            ...(latest ? { lastTaskId: latest.taskId } : {}),
          };
        }));
      return ok({ states, updatedAt: timestamp() });
    },
  };
}
