import { randomBytes, randomUUID } from 'node:crypto';
import { validateNodeKernels, type NodeConfig } from '@miobridge/core';
import type { NodeCoreComposition } from '../../composition.js';
import type { DashboardServerDependencies, OperationsResult } from './composition.js';
import { SshDeploymentService } from './sshDeployment.js';

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
