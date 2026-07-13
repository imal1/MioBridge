import type { NextApiRequest, NextApiResponse } from 'next';
import { DeployManager, type DeployTarget } from '@/server/services/deployManager';
import { NodeManager } from '@/server/services/nodeManager';
import type { ApiResponse, NodeConfig, SshAuthMethod } from '@/server/types';
import { logger } from '@/server/utils/logger';
import { validateUploadedPrivateKey } from '@/server/services/sshCredential';

interface UnsavedSshPayload {
  host?: unknown;
  user?: unknown;
  port?: unknown;
  authMethod?: unknown;
  hostKey?: unknown;
  password?: unknown;
  privateKey?: unknown;
}

async function targetFromSavedNode(node: NodeConfig, nodeManager: NodeManager): Promise<DeployTarget> {
  if (!node.ssh) throw new Error('节点未配置 SSH 信息');
  const ssh = {
    host: node.host,
    user: node.ssh.user,
    port: node.ssh.port,
    authMethod: node.ssh.authMethod,
    hostKey: node.ssh.hostKey,
  };
  return {
    nodeId: node.id,
    secret: node.secret,
    kernels: node.kernels,
    ssh: node.ssh.authMethod === 'privateKey'
      ? { ...ssh, privateKey: await nodeManager.getNodePrivateKey(node) }
      : { ...ssh, password: node.ssh.password },
  };
}

function targetFromUnsavedSsh(value: UnsavedSshPayload): DeployTarget {
  const host = typeof value.host === 'string' ? value.host.trim() : '';
  const user = typeof value.user === 'string' ? value.user.trim() : '';
  const authMethod = value.authMethod as SshAuthMethod;
  if (!host || !user || (authMethod !== 'password' && authMethod !== 'privateKey')) {
    throw new Error('SSH 连接信息不完整');
  }
  const port = value.port === undefined ? undefined : Number(value.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('SSH 端口无效');
  }
  const hostKey = typeof value.hostKey === 'string' ? value.hostKey : '';
  if (authMethod === 'password') {
    if (value.privateKey !== undefined) throw new Error('密码认证不能同时提交 SSH 私钥');
    if (typeof value.password !== 'string' || !value.password) throw new Error('SSH 密码不可用');
    return {
      nodeId: 'kernel-detection', secret: '', kernels: [],
      ssh: { host, user, port, authMethod, hostKey, password: value.password },
    };
  }
  if (value.password !== undefined) throw new Error('私钥认证不能同时提交 SSH 密码');
  if (typeof value.privateKey !== 'string' || !value.privateKey) throw new Error('SSH 私钥文件不可用');
  validateUploadedPrivateKey(value.privateKey);
  return {
    nodeId: 'kernel-detection', secret: '', kernels: [],
    ssh: { host, user, port, authMethod, hostKey, privateKey: value.privateKey },
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
    const nodeManager = NodeManager.getInstance();
    let target: DeployTarget;
    if (req.body?.nodeId) {
      const nodes = await nodeManager.loadNodes({ triggerDeploy: false });
      const node = nodes.find(item => item.id === req.body.nodeId);
      if (!node) {
        return res.status(404).json({ success: false, error: `节点 ${req.body.nodeId} 不存在`, timestamp: new Date().toISOString() });
      }
      target = await targetFromSavedNode(node, nodeManager);
    } else if (req.body?.ssh && typeof req.body.ssh === 'object') {
      target = targetFromUnsavedSsh(req.body.ssh);
    } else {
      return res.status(400).json({ success: false, error: '缺少节点或 SSH 连接信息', timestamp: new Date().toISOString() });
    }

    try {
      const detections = await DeployManager.getInstance().detectKernels(target);
      return res.status(200).json({ success: true, data: detections, timestamp: new Date().toISOString() });
    } catch {
      logger.error('内核检测失败');
      return res.status(502).json({
        success: false,
        error: '内核检测失败，请检查 SSH 连接信息',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
}
