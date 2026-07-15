import { randomBytes, randomUUID } from 'node:crypto';
import { validateNodeKernels, type NodeConfig } from '@miobridge/core';
import type { NodeCoreComposition } from '../../composition.js';
import type { DashboardServerDependencies, OperationsResult } from './composition.js';
import { SshDeploymentService } from './sshDeployment.js';
import { SubscriptionJobService } from '../../operations/subscriptionJobs.js';

function result<T>(data: T): OperationsResult<T> {
  return { success: true, data, timestamp: new Date().toISOString() };
}

function inputObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求内容无效');
  return value as Record<string, unknown>;
}

async function findNode(composition: NodeCoreComposition, nodeId: string): Promise<NodeConfig> {
  const node = (await composition.repository.list({ enabledOnly: false })).find(item => item.id === nodeId);
  if (!node) throw new Error(`节点 ${nodeId} 不存在`);
  return node;
}

export function createNodeDashboardDependencies(composition: NodeCoreComposition): DashboardServerDependencies {
  const deployment = new SshDeploymentService(composition);
  const subscriptions = new SubscriptionJobService(composition);
  return {
    core: composition.core,
    subscription: {
      async preflight() { return result(await subscriptions.preflight()); },
      async start(idempotencyKey) { return result(await subscriptions.start(idempotencyKey ? { idempotencyKey } : {})); },
      async list() { return result({ jobs: await subscriptions.list() }); },
      async get(jobId) { return result(await subscriptions.get(jobId)); },
      async retry(jobId) { return result(await subscriptions.retry(jobId)); },
      async events(jobId, afterEventId) { return result({ events: await subscriptions.events(jobId, afterEventId) }); },
      async artifacts() { return result({ artifacts: await subscriptions.artifacts() }); },
      async previewArtifact(name) { return result(await subscriptions.preview(name)); },
      async validateArtifacts(name) { return result({ artifacts: await subscriptions.validateArtifact(name) }); },
      async policy() { return result(await subscriptions.policy()); },
      async updatePolicy(body) { return result(await subscriptions.updatePolicy(body)); },
    },
    operations: {
      async getClusterStatus() {
        return result(await composition.aggregation.getClusterStatus());
      },
      async getClusterHealth(nodeId) {
        const cluster = await composition.aggregation.getClusterStatus();
        return result(nodeId ? cluster.nodes.find(node => node.nodeId === nodeId) ?? null : cluster);
      },
      async triggerClusterUpdate() {
        return result(await composition.core.updateSubscription());
      },
      async addNode(body) {
        const input = inputObject(body);
        for (const field of ['name', 'host', 'location', 'sshUser', 'sshAuthMethod'] as const) {
          if (typeof input[field] !== 'string' || !input[field]) throw new Error(`缺少字段: ${field}`);
        }
        const nodes = await composition.repository.list({ enabledOnly: false });
        if (nodes.some(node => node.host === input.host)) throw new Error('该主机已存在');
        const id = randomUUID();
        const credentialRef = `ssh-credentials/${id}`;
        const authMethod = input.sshAuthMethod === 'privateKey' ? 'privateKey' : 'password';
        const credential = authMethod === 'privateKey' ? input.sshPrivateKey : input.sshPassword;
        if (typeof credential !== 'string' || credential.length === 0) throw new Error('缺少 SSH 凭据');
        const sshPort = input.sshPort === undefined ? 22 : Number(input.sshPort);
        if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) throw new Error('SSH 端口无效');
        await composition.core.state.set(credentialRef, credential);
        const node: NodeConfig = {
          id,
          name: String(input.name),
          host: String(input.host),
          port: 3001,
          secret: randomBytes(32).toString('hex'),
          kernels: validateNodeKernels(input.kernels, true),
          location: String(input.location),
          enabled: true,
          ...(Array.isArray(input.tags) ? { tags: validateTags(input.tags) } : {}),
          ssh: {
            user: String(input.sshUser),
            ...(sshPort === 22 ? {} : { port: sshPort }),
            authMethod,
            credentialRef,
            hostKey: typeof input.sshHostKey === 'string' ? input.sshHostKey : '',
          },
          agent: { deployed: false, version: '', status: 'not_deployed', lastDeploy: '' },
        };
        await composition.repository.save([...nodes, node]);
        return result(publicNode(node));
      },
      async preflightNode(body) {
        return result(await deployment.preflight(body));
      },
      async updateNode(nodeId, body) {
        const input = inputObject(body);
        const existing = await findNode(composition, nodeId);
        const nodes = await composition.repository.list({ enabledOnly: false });
        const name = input.name === undefined ? existing.name : String(input.name).trim();
        const host = input.host === undefined ? existing.host : String(input.host).trim();
        const location = input.location === undefined ? existing.location : String(input.location).trim();
        const tags = input.tags === undefined ? existing.tags : validateTags(input.tags);
        if (!name || !host || !location) throw new Error('名称、主机和地域不能为空');
        if (nodes.some(node => node.id !== nodeId && node.host === host)) throw new Error('该主机已存在');
        const credential = input.sshPassword ?? input.sshPrivateKey;
        const sshPort = input.sshPort === undefined ? existing.ssh?.port : Number(input.sshPort);
        if (sshPort !== undefined && (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535)) throw new Error('SSH 端口无效');
        if (credential !== undefined) {
          if (typeof credential !== 'string' || !credential) throw new Error('SSH 凭据无效');
          if (!existing.ssh?.credentialRef) throw new Error('节点缺少凭据引用');
          await composition.core.state.set(existing.ssh.credentialRef, credential);
        }
        const updated = await composition.repository.update(nodeId, current => ({
          ...current, name, host, location,
          ...(tags?.length ? { tags } : { tags: [] }),
          enabled: input.enabled === undefined ? current.enabled : Boolean(input.enabled),
          ...(current.ssh ? { ssh: {
            ...current.ssh,
            user: input.sshUser === undefined ? current.ssh.user : String(input.sshUser).trim(),
            ...(sshPort === undefined ? {} : { port: sshPort }),
            authMethod: input.sshAuthMethod === undefined ? current.ssh.authMethod : input.sshAuthMethod === 'privateKey' ? 'privateKey' : 'password',
            hostKey: host === current.host ? current.ssh.hostKey : '',
          } } : {}),
        }));
        return result(publicNode(updated));
      },
      async deleteNode(nodeId, force = false) {
        const nodes = await composition.repository.list({ enabledOnly: false });
        const node = nodes.find(item => item.id === nodeId);
        if (!node) throw new Error(`节点 ${nodeId} 不存在`);
        if (node.agent?.deployed && !force) throw new Error('节点仍安装 Agent，请先在部署中心卸载');
        await composition.repository.save(nodes.filter(item => item.id !== nodeId));
        if (node.ssh?.credentialRef) await composition.core.state.del(node.ssh.credentialRef);
        return result({ nodeId, deleted: true });
      },
      async updateNodeKernels(nodeId, kernels) {
        const validated = validateNodeKernels(kernels, true);
        const node = await findNode(composition, nodeId);
        return result(node.agent?.deployed
          ? await deployment.configureKernels(nodeId, validated)
          : await composition.repository.update(nodeId, current => ({ ...current, kernels: validated })));
      },
      async restartAgent(nodeId) {
        await deployment.agentAction(nodeId, 'restart');
        return result({ nodeId, status: 'running' });
      },
      async startAgent(nodeId) {
        await deployment.agentAction(nodeId, 'start');
        return result({ nodeId, status: 'running' });
      },
      async stopAgent(nodeId) {
        await deployment.agentAction(nodeId, 'stop');
        return result({ nodeId, status: 'stopped' });
      },
      async uninstallAgent(nodeId) {
        await deployment.agentAction(nodeId, 'uninstall');
        return result({ nodeId, status: 'not_deployed' });
      },
      async updateAgent(nodeId) {
        return result(await composition.agent.get(await findNode(composition, nodeId), '/api/update'));
      },
      async deployToNode(nodeId, kernels) {
        return result(await deployment.startDeployment(nodeId, kernels));
      },
      async getDeployProgress(nodeId) {
        return result(deployment.getProgress(nodeId));
      },
      async getAllDeployStatuses(nodeIds) {
        return result({ deployments: deployment.getAllProgress(nodeIds) });
      },
      async detectKernels(body) {
        return result(await deployment.detect(body));
      },
      async installKernel(nodeId, kernelType) {
        return result(await deployment.installKernel(nodeId, kernelType));
      },
      async uninstallKernel(nodeId, kernelType) {
        return result(await deployment.uninstallKernel(nodeId, kernelType));
      },
      async kernelAction(nodeId, kernelType, action) {
        return result(await deployment.kernelAction(nodeId, kernelType, action));
      },
      async startComponentDeployment(nodeId, component, operation, input) {
        return result(await deployment.startComponentDeployment(nodeId, component, operation, input));
      },
      async getComponentDeployments(nodeIds) {
        return result({ deployments: await deployment.getComponentDeployments(nodeIds) });
      },
      async getComponentDeployment(taskId) {
        return result(await deployment.getComponentDeployment(taskId));
      },
      async cancelComponentDeployment(taskId) {
        return result(await deployment.cancelComponentDeployment(taskId));
      },
      async retryComponentDeployment(taskId) {
        return result(await deployment.retryComponentDeployment(taskId));
      },
      async getDeploymentEvents(taskId, afterEventId) {
        return result({ events: await deployment.getDeploymentEvents(taskId, afterEventId) });
      },
      async getDeploymentLog(taskId) {
        return result({ taskId, content: await deployment.deploymentLog(taskId) });
      },
      async getManualAgentConfig(nodeId) {
        return result({ nodeId, content: await deployment.manualAgentConfig(nodeId) });
      },
      async getComponentStates(nodeIds) {
        const [cluster, taskRecord] = await Promise.all([
          composition.aggregation.getClusterStatus(),
          deployment.getComponentDeployments(nodeIds),
        ]);
        const allowed = nodeIds ? new Set(nodeIds) : null;
        const latestTasks = new Map<string, (typeof taskRecord)[string]>();
        for (const task of Object.values(taskRecord)) {
          const key = `${task.nodeId}:${task.component}`;
          const current = latestTasks.get(key);
          if (!current || Date.parse(task.createdAt) > Date.parse(current.createdAt)) latestTasks.set(key, task);
        }
        const taskState = (nodeId: string, component: string, fallback: string) => {
          const task = latestTasks.get(`${nodeId}:${component}`);
          if (!task || task.status === 'cancelled' || task.status === 'success') return { installState: fallback };
          if (task.status === 'error') return { installState: 'failed', lastTaskId: task.taskId, error: task.message };
          const installState = task.operation === 'uninstall' ? 'uninstalling'
            : task.operation === 'upgrade' ? 'upgrading' : 'installing';
          return { installState, lastTaskId: task.taskId };
        };
        const states = cluster.nodes.filter(node => !allowed || allowed.has(node.nodeId)).flatMap(node => {
          const agentInstalled = node.agent?.deployed === true;
          const agentRuntime = !agentInstalled ? 'not_applicable' : node.online ? 'running' : node.agent?.status === 'stopped' ? 'stopped' : node.agent?.status === 'error' ? 'error' : 'degraded';
          const agent = {
            nodeId: node.nodeId, component: 'agent',
            ...taskState(node.nodeId, 'agent', agentInstalled ? 'installed' : 'not_installed'),
            runtimeState: agentRuntime, monitorState: 'not_applicable',
            ...(node.version ? { version: node.version } : {}),
            ...(!latestTasks.has(`${node.nodeId}:agent`) && node.agent?.deploymentId ? { lastTaskId: node.agent.deploymentId } : {}),
          };
          const mihomo = {
            nodeId: node.nodeId, component: 'mihomo',
            ...taskState(node.nodeId, 'mihomo', node.mihomoAvailable ? 'installed' : node.online ? 'not_installed' : 'unknown'),
            runtimeState: 'not_applicable', monitorState: 'not_applicable', path: '/usr/local/bin/mihomo',
            ...(node.mihomoVersion ? { version: node.mihomoVersion } : {}),
          };
          const kernels = node.kernels.map(kernel => ({
            nodeId: node.nodeId, component: kernel.type,
            ...taskState(node.nodeId, kernel.type, kernel.detected ? 'installed' : node.online ? 'not_installed' : 'unknown'),
            runtimeState: kernel.accessible ? 'running' : kernel.detected ? 'stopped' : 'not_applicable',
            monitorState: kernel.monitored ? 'monitored' : 'unmonitored',
            ...(kernel.version ? { version: kernel.version } : {}),
            ...(kernel.configPaths[0] ? { configPath: kernel.configPaths[0] } : {}),
            sources: kernel.nodesCount,
            ...(kernel.error ? { error: kernel.error } : {}),
          }));
          return [agent, mihomo, ...kernels];
        });
        return result({ states, updatedAt: cluster.lastUpdated });
      },
    },
    config: {
      getConfigs() {
        return result({ configs: composition.core.config.getConfig().singBoxConfigs });
      },
      async updateConfigs(configs) {
        composition.core.yaml.updateSingBoxConfigs(configs);
        return result({ configs, count: configs.length });
      },
      async getRemoteLogs(nodeId, filters) {
        return result(await composition.agent.logs(await findNode(composition, nodeId), {
          ...(filters?.file ? { file: filters.file } : {}),
          ...(filters?.level ? { level: filters.level } : {}),
          ...(filters?.query ? { query: filters.query } : {}),
        }));
      },
    },
    yaml: {
      getFullConfig: () => result(composition.core.config.getFullConfig()),
      getFrontendConfig() {
        const full = composition.core.config.getFullConfig();
        return result({
          ...full,
          app: {
            name: 'miobridge',
            version: composition.core.config.getAppVersion(),
            environment: 'production',
            port: 3000,
            ...full.app,
          },
          protocols: { sing_box_configs: composition.core.config.getConfig().singBoxConfigs, ...full.protocols },
        });
      },
      async generateConfig(templatePath, outputPath) {
        return result(composition.core.yaml.generateConfig(templatePath, outputPath));
      },
      validateConfig: () => result(composition.core.yaml.validateConfig()),
    },
    convert: {
      async convertContent(content) {
        return result({ clashConfig: await composition.mihomo.convertToClashByContent(content) });
      },
      async diagnoseMihomo() {
        const available = await composition.mihomo.checkHealth();
        const version = available ? await composition.mihomo.getVersion() : undefined;
        return result({ available, version });
      },
      async testProtocols() {
        return result({ protocols: ['vless', 'vmess', 'trojan', 'hysteria2', 'tuic', 'shadowsocks'] });
      },
    },
  };
}

function validateTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('节点标签必须是数组');
  const tags = value.map(item => {
    if (typeof item !== 'string' || !item.trim() || item.trim().length > 48) throw new Error('节点标签必须是 1 到 48 个字符');
    return item.trim();
  });
  return [...new Set(tags)].slice(0, 20);
}

function publicNode(node: NodeConfig): Omit<NodeConfig, 'secret'> {
  const { secret, ssh, ...safe } = node;
  void secret;
  if (!ssh) return safe;
  const { password, credentialRef, ...safeSsh } = ssh;
  void password; void credentialRef;
  return { ...safe, ssh: safeSsh };
}
