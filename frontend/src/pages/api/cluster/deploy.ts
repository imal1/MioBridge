import type { NextApiRequest, NextApiResponse } from 'next';
import { NodeManager } from '@/server/services/nodeManager';
import { DeployManager } from '@/server/services/deployManager';
import { getDeployStatus, setDeployStatus } from '@/server/services/deployProgressStore';
import { logger } from '@/server/utils/logger';
import type { ApiResponse, DeployStatus, NodeConfig } from '@/server/types';
import type { DeployTarget } from '@/server/services/deployManager';

interface PrivateKeyResolver {
  getNodePrivateKey(node: NodeConfig): Promise<string>;
}

export async function createDeployTarget(
  node: NodeConfig,
  privateKeyResolver: PrivateKeyResolver,
): Promise<DeployTarget> {
  if (!node.ssh) throw new Error('节点未配置 SSH 信息');

  const base = {
    nodeId: node.id,
    secret: node.secret,
    agentPort: node.port || node.agent?.port || 3001,
    kernel: node.kernel || 'sing-box',
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed', timestamp: new Date().toISOString() });
  }

  try {
    const { nodeId } = req.body || {};
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

    // Initialize progress tracking (single DeployStatus per design)
    const startedAt = Date.now();
    const initialStatus: DeployStatus = {
      nodeId: node.id,
      step: 'connect',
      status: 'running',
      message: '正在建立 SSH 连接...',
      progress: 0,
      startedAt,
    };
    await setDeployStatus(nodeId, initialStatus);

    // Start deploy asynchronously
    const deployTarget = await createDeployTarget(node, nodeManager);
    const persistRecordedHostKey = async () => {
      if (!node.ssh?.hostKey && deployTarget.ssh.hostKey) {
        await nodeManager.updateNodeSshHostKey(node.id, deployTarget.ssh.hostKey);
      }
    };

    const deployPromise = deployManager.deployToNode(
      deployTarget,
      (step) => {
        // Map old DeployStep to new DeployStatus format
        const status: DeployStatus = {
          nodeId: node.id,
          step: step.step,
          status: step.status,
          message: step.message,
          progress: step.progress,
          startedAt,
        };
        // 进度回调是同步的；写入顺序由 store 内部写链保证
        void setDeployStatus(nodeId, status);
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
      await persistRecordedHostKey();
      await nodeManager.updateNodeAgentInfo(node.id, {
        deployed: result.success,
        status: result.success ? 'running' : 'error',
        lastDeploy: new Date().toISOString(),
        port: deployTarget.agentPort,
      });
      logger.info(`Deploy API: 节点 ${nodeId} 部署完成: ${result.success ? '成功' : '失败'} - ${result.message}`);
      const currentStatus = await getDeployStatus(nodeId);
      const finalStatus: DeployStatus = {
        nodeId,
        step: result.success ? 'done' : (currentStatus?.step || 'connect'),
        status: result.success ? 'success' : 'error',
        message: result.message,
        progress: result.success ? 100 : (currentStatus?.progress || 0),
        startedAt: Date.now(),
      };
      await setDeployStatus(nodeId, finalStatus);
    }).catch(async (err) => {
      await persistRecordedHostKey();
      await nodeManager.updateNodeAgentInfo(node.id, {
        deployed: false,
        status: 'error',
        lastDeploy: new Date().toISOString(),
        port: deployTarget.agentPort,
      });
      logger.error(`Deploy API: 节点 ${nodeId} 部署异常: ${err.message}`);
      const currentStatus = await getDeployStatus(nodeId);
      const errorStatus: DeployStatus = {
        nodeId,
        step: currentStatus?.step || 'connect',
        status: 'error',
        message: `部署异常: ${err.message}`,
        progress: currentStatus?.progress || 0,
        startedAt: Date.now(),
      };
      await setDeployStatus(nodeId, errorStatus);
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
