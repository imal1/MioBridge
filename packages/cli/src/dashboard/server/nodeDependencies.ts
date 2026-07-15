import { randomBytes, randomUUID } from 'node:crypto';
import { validateNodeKernels, type NodeConfig } from '@miobridge/core';
import type { NodeCoreComposition } from '../../composition.js';
import type { DashboardServerDependencies, OperationsResult } from './composition.js';
import {
  assessNodeDeployment,
  planNodeDeployment,
  SshDeploymentService,
  type DeploymentPlan,
  validatePrivateKey,
} from './sshDeployment.js';
import { createNodeSetupAdapters } from '../../setup/nodeAdapters.js';
import { LocalKernelInstallationService } from '../../setup/kernelService.js';

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

async function getDeploymentPlans(
  composition: NodeCoreComposition,
  nodeIds?: readonly string[],
): Promise<Record<string, DeploymentPlan>> {
  const [cluster, configuredNodes] = await Promise.all([
    composition.aggregation.getClusterStatus(),
    composition.repository.list({ enabledOnly: false }),
  ]);
  const allowed = nodeIds ? new Set(nodeIds) : null;
  const configuredById = new Map(configuredNodes.map(node => [node.id, node]));
  const plans = await Promise.all(cluster.nodes
    .filter(node => !allowed || allowed.has(node.nodeId))
    .map(async node => {
      const configured = configuredById.get(node.nodeId);
      const credentialAvailable = configured?.ssh?.credentialRef
        ? Boolean(await composition.core.state.get(configured.ssh.credentialRef))
        : false;
      return planNodeDeployment(node, {
        sshConfigured: Boolean(configured?.ssh?.user && configured.ssh.credentialRef),
        credentialAvailable,
        ...(configured?.ssh?.user ? {
          sshHost: configured.host,
          sshUser: configured.ssh.user,
          sshPort: configured.ssh.port ?? 22,
        } : {}),
      });
    }));
  return Object.fromEntries(plans.map(plan => [plan.nodeId, plan]));
}

export function createNodeDashboardDependencies(composition: NodeCoreComposition): DashboardServerDependencies {
  const deployment = new SshDeploymentService(
    composition,
    new LocalKernelInstallationService(composition.paths, createNodeSetupAdapters()),
  );
  return {
    core: composition.core,
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
        await composition.core.state.set(credentialRef, credential);
        const node: NodeConfig = {
          id,
          kind: 'child',
          name: String(input.name),
          host: String(input.host),
          port: 3001,
          secret: randomBytes(32).toString('hex'),
          kernels: validateNodeKernels(input.kernels, true),
          location: String(input.location),
          enabled: true,
          ssh: {
            user: String(input.sshUser),
            authMethod,
            credentialRef,
            hostKey: '',
          },
          agent: { deployed: false, version: '', status: 'not_deployed', lastDeploy: '' },
        };
        await composition.repository.save([...nodes, node]);
        return result(node);
      },
      async updateNodeKernels(nodeId, kernels) {
        const validated = validateNodeKernels(kernels, true);
        return result(await composition.repository.update(nodeId, node => ({ ...node, kernels: validated })));
      },
      async updateNodeConnection(nodeId, body) {
        const input = inputObject(body);
        const host = typeof input.host === 'string' ? input.host.trim() : '';
        const user = typeof input.user === 'string' ? input.user.trim() : '';
        const port = input.port === undefined ? 22 : Number(input.port);
        const authMethod = input.authMethod === 'privateKey' ? 'privateKey' : input.authMethod === 'password' ? 'password' : null;
        const credential = authMethod === 'privateKey' ? input.privateKey : input.password;
        if (!host || !user || !authMethod) throw new Error('SSH 连接信息不完整');
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 端口无效');
        if (typeof credential !== 'string' || !credential) throw new Error('SSH 凭据不完整');
        if (authMethod === 'privateKey') validatePrivateKey(credential);
        const nodes = await composition.repository.list({ enabledOnly: false });
        const current = nodes.find(node => node.id === nodeId);
        if (!current) throw new Error(`节点 ${nodeId} 不存在`);
        if (current.kind === 'local' || current.id === 'local') throw new Error('本机节点不使用 SSH 凭据');
        if (nodes.some(node => node.id !== nodeId && node.host === host)) throw new Error('该主机已被其他节点使用');
        const credentialRef = current.ssh?.credentialRef ?? `ssh-credentials/${nodeId}`;
        await composition.core.state.set(credentialRef, credential);
        return result(await composition.repository.update(nodeId, node => ({
          ...node,
          host,
          ssh: {
            user,
            port,
            authMethod,
            credentialRef,
            hostKey: '',
          },
        })));
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
      async deployToNode(nodeId, kernels, scope) {
        return result(await deployment.startDeployment(nodeId, kernels, scope));
      },
      async deployBatch(nodeIds) {
        const plans = await getDeploymentPlans(composition, nodeIds);
        const results: Array<{
          nodeId: string;
          status: 'started' | 'skipped' | 'error';
          message: string;
          scope?: string;
          deploymentId?: string;
        }> = [];
        for (const plan of Object.values(plans)) {
          if (!plan.recommendedScope) {
            results.push({
              nodeId: plan.nodeId,
              status: 'skipped',
              message: plan.ready ? '节点已经就绪' : plan.blockers[0] ?? '节点暂不可部署',
            });
            continue;
          }
          try {
            const started = await deployment.startDeployment(plan.nodeId, undefined, plan.recommendedScope);
            results.push({
              nodeId: plan.nodeId,
              status: 'started',
              scope: plan.recommendedScope,
              deploymentId: started.deploymentId,
              message: '部署已启动',
            });
          } catch (error) {
            results.push({
              nodeId: plan.nodeId,
              status: 'error',
              message: error instanceof Error ? error.message : '部署启动失败',
            });
          }
        }
        return result({
          started: results.filter(item => item.status === 'started').length,
          skipped: results.filter(item => item.status === 'skipped').length,
          failed: results.filter(item => item.status === 'error').length,
          results,
        });
      },
      async getDeploymentPlans(nodeIds) {
        return result({ plans: await getDeploymentPlans(composition, nodeIds) });
      },
      async getDeployProgress(nodeId) {
        const cluster = await composition.aggregation.getClusterStatus();
        const node = cluster.nodes.find(item => item.nodeId === nodeId);
        if (!node) throw new Error(`节点 ${nodeId} 不存在`);
        return result(assessNodeDeployment(node, deployment.getProgress(nodeId)));
      },
      async getAllDeployStatuses(nodeIds) {
        const cluster = await composition.aggregation.getClusterStatus();
        const allowed = nodeIds ? new Set(nodeIds) : null;
        const progress = deployment.getAllProgress(nodeIds);
        return result({ deployments: Object.fromEntries(cluster.nodes
          .filter(node => !allowed || allowed.has(node.nodeId))
          .map(node => [node.nodeId, assessNodeDeployment(node, progress[node.nodeId])])) });
      },
      subscribeDeployProgress(listener) {
        return deployment.subscribe(status => {
          if (status.status === 'pending' || status.status === 'running') {
            listener(status);
            return;
          }
          void composition.aggregation.getClusterStatus().then(cluster => {
            const node = cluster.nodes.find(item => item.nodeId === status.nodeId);
            listener(node ? assessNodeDeployment(node, status) : status);
          }).catch(() => listener(status));
        });
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
