import type { NextApiRequest, NextApiResponse } from 'next';
import * as crypto from 'crypto';
import { NodeManager } from '@/server/services/nodeManager';
import { DeployManager } from '@/server/services/deployManager';
import { beginDeployStatus, getDeployStatus, setDeployStatusIfCurrent } from '@/server/services/deployProgressStore';
import { getStateStore } from '@/server/services/stateStore';
import { logger } from '@/server/utils/logger';
import { validateKernelConfigs, type ApiResponse, type DeployStatus, type NodeConfig, type NodeKernelConfig } from '@/server/types';
import type { DeployResult, DeployTarget } from '@/server/services/deployManager';

interface PrivateKeyResolver {
  getNodePrivateKey(node: NodeConfig): Promise<string>;
}

interface DeployPersistence {
  completeDeploymentIfCurrent(
    nodeId: string,
    deploymentId: string,
    completion: { kernels?: NodeKernelConfig[]; agent: Partial<NonNullable<NodeConfig['agent']>>; hostKey?: string },
  ): Promise<boolean>;
}

export async function createDeployTarget(
  node: NodeConfig,
  privateKeyResolver: PrivateKeyResolver,
  kernels: NodeKernelConfig[] = node.kernels,
): Promise<DeployTarget> {
  if (!node.ssh) throw new Error('节点未配置 SSH 信息');

  const base = {
    nodeId: node.id,
    secret: node.secret,
    agentPort: node.port || node.agent?.port || 3001,
    kernels,
  };
  const sshBase = {
    host: node.host,
    user: node.ssh.user,
    port: node.ssh.port,
    authMethod: node.ssh.authMethod,
    hostKey: node.ssh.hostKey,
  };

  if (node.ssh.authMethod === 'privateKey') {
    return {
      ...base,
      ssh: { ...sshBase, privateKey: await privateKeyResolver.getNodePrivateKey(node) },
    };
  }

  return {
    ...base,
    ssh: { ...sshBase, password: node.ssh.password },
  };
}

export async function persistDeployResult(
  node: NodeConfig,
  requestedKernels: NodeKernelConfig[],
  deploymentId: string,
  agentPort: number,
  result: DeployResult,
  persistence: DeployPersistence,
  hostKey?: string,
): Promise<void> {
  const monitoredTypes = new Set(
    result.kernels.filter(item => item.monitored).map(item => item.type),
  );
  const monitoredConfigs = requestedKernels.filter(kernel => monitoredTypes.has(kernel.type));
  await persistence.completeDeploymentIfCurrent(node.id, deploymentId, {
    ...(result.success && monitoredConfigs.length > 0 ? { kernels: monitoredConfigs } : {}),
    agent: {
    ...(result.outcome !== 'error' ? { deployed: true } : {}),
    status: result.outcome !== 'error' ? 'running' : 'error',
    lastDeploy: new Date().toISOString(),
    port: agentPort,
    },
    ...(hostKey ? { hostKey } : {}),
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed', timestamp: new Date().toISOString() });
  }

  try {
    const { nodeId, kernels } = req.body || {};
    if (!nodeId) {
      return res.status(400).json({ success: false, error: '缺少 nodeId', timestamp: new Date().toISOString() });
    }

    const nodeManager = NodeManager.getInstance();
    const deployManager = DeployManager.getInstance();
    const nodes = await nodeManager.loadNodes();
    const node = nodes.find(n => n.id === nodeId);

    if (!node) {
      return res.status(404).json({ success: false, error: `节点 ${nodeId} 不存在`, timestamp: new Date().toISOString() });
    }

    if (!node.ssh) {
      return res.status(400).json({ success: false, error: '节点未配置 SSH 信息', timestamp: new Date().toISOString() });
    }

    let requestedKernels: NodeKernelConfig[];
    try {
      const normalized = validateKernelConfigs(kernels === undefined ? node.kernels : kernels);
      requestedKernels = normalized.map(kernel => {
        const current = node.kernels.find(item => item.type === kernel.type);
        return current?.configPath ? { ...kernel, configPath: current.configPath } : kernel;
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '内核配置无效',
        timestamp: new Date().toISOString(),
      });
    }

    const deploymentId = crypto.randomUUID();
    const startedAt = Date.now();
    const initialStatus: DeployStatus = {
      nodeId: node.id,
      deploymentId,
      step: 'connect',
      status: 'running',
      message: '正在建立 SSH 连接...',
      progress: 0,
      startedAt,
    };
    const deployTarget = await createDeployTarget(node, nodeManager, requestedKernels);
    await getStateStore().withLock(`deploy-start/${nodeId}`, async () => {
      await nodeManager.beginDeployment(nodeId, deploymentId);
      await beginDeployStatus(nodeId, initialStatus);
    });

    const deployPromise = deployManager.deployToNode(
      deployTarget,
      (step) => {
        // Map old DeployStep to new DeployStatus format
        const status: DeployStatus = {
          nodeId: node.id,
          deploymentId,
          step: step.step,
          status: step.status,
          message: step.message,
          progress: step.progress,
          startedAt,
        };
        // 进度回调是同步的；写入顺序由 store 内部写链保证
        void setDeployStatusIfCurrent(nodeId, deploymentId, status);
      },
    );

    // Return immediately with 202 Accepted
    res.status(202).json({
      success: true,
      message: `节点 ${node.name} 部署已启动`,
      timestamp: new Date().toISOString(),
    });

    // Wait for deploy to finish (in background, after response sent)
    deployPromise.then(async (result) => {
      await persistDeployResult(
        node,
        requestedKernels,
        deploymentId,
        deployTarget.agentPort || 3001,
        result,
        nodeManager,
        !node.ssh?.hostKey ? deployTarget.ssh.hostKey : undefined,
      );
      logger.info(`Deploy API: 节点 ${nodeId} 部署完成: ${result.success ? '成功' : '失败'} - ${result.message}`);
      const currentStatus = await getDeployStatus(nodeId);
      const finalStatus: DeployStatus = {
        nodeId,
        deploymentId,
        step: result.success ? 'done' : (currentStatus?.step || 'connect'),
        status: result.success ? 'success' : 'error',
        message: result.message,
        progress: result.success ? 100 : (currentStatus?.progress || 0),
        startedAt,
      };
      await setDeployStatusIfCurrent(nodeId, deploymentId, finalStatus);
    }).catch(async (err) => {
      await nodeManager.completeDeploymentIfCurrent(node.id, deploymentId, {
        agent: {
          status: 'error',
          lastDeploy: new Date().toISOString(),
          port: deployTarget.agentPort,
        },
        ...(!node.ssh?.hostKey && deployTarget.ssh.hostKey ? { hostKey: deployTarget.ssh.hostKey } : {}),
      });
      logger.error(`Deploy API: 节点 ${nodeId} 部署异常: ${err.message}`);
      const currentStatus = await getDeployStatus(nodeId);
      const errorStatus: DeployStatus = {
        nodeId,
        deploymentId,
        step: currentStatus?.step || 'connect',
        status: 'error',
        message: `部署异常: ${err.message}`,
        progress: currentStatus?.progress || 0,
        startedAt,
      };
      await setDeployStatusIfCurrent(nodeId, deploymentId, errorStatus);
    });
  } catch (error: any) {
    logger.error('部署失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
