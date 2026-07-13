import type { NextApiRequest, NextApiResponse } from 'next';
import { NodeManager } from '@/server/services/nodeManager';
import { logger } from '@/server/utils/logger';
import { validateKernelConfigs, type ApiResponse, type NodeConfig } from '@/server/types';
import { validateUploadedPrivateKey } from '@/server/services/sshCredential';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed', timestamp: new Date().toISOString() });
  }

  try {
    const nodeManager = NodeManager.getInstance();
    const {
      name, host, port, kernels, location, sshUser,
      sshAuthMethod, sshPassword, sshPrivateKey,
    } = req.body || {};

    if (!name || !host) {
      return res.status(400).json({ success: false, error: '缺少必填字段 name 或 host', timestamp: new Date().toISOString() });
    }

    try {
      validateKernelConfigs(kernels);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : '内核配置无效',
        timestamp: new Date().toISOString(),
      });
    }

    if (!sshUser?.trim()) {
      return res.status(400).json({ success: false, error: 'SSH 用户名不能为空', timestamp: new Date().toISOString() });
    }
    if (sshAuthMethod !== 'password' && sshAuthMethod !== 'privateKey') {
      return res.status(400).json({ success: false, error: 'SSH 认证方式无效', timestamp: new Date().toISOString() });
    }
    if ((sshAuthMethod === 'password' && sshPrivateKey) ||
        (sshAuthMethod === 'privateKey' && sshPassword)) {
      return res.status(400).json({ success: false, error: 'SSH 密码和私钥不能同时提交', timestamp: new Date().toISOString() });
    }
    if (sshAuthMethod === 'password' && !sshPassword?.trim()) {
      return res.status(400).json({ success: false, error: 'SSH 密码不能为空', timestamp: new Date().toISOString() });
    }
    if (sshAuthMethod === 'privateKey') {
      if (!sshPrivateKey) {
        return res.status(400).json({ success: false, error: '请选择 SSH 私钥文件', timestamp: new Date().toISOString() });
      }
      try {
        validateUploadedPrivateKey(sshPrivateKey);
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : '无效的 SSH 私钥文件',
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Build NodeConfig from form data
    const nodeConfig: NodeConfig = {
      id: '', // will be auto-generated
      name,
      host,
      port: parseInt(port, 10) || 3001,
      secret: '', // will be auto-generated
      // 选择由紧随其后的 deploy 请求携带；仅成功监听的内核才会提交到节点配置。
      kernels: [],
      location: location || '',
      enabled: true,
      ssh: {
        user: sshUser || 'root',
        authMethod: sshAuthMethod,
        hostKey: '',
        ...(sshAuthMethod === 'password' ? { password: sshPassword } : {}),
      },
      agent: {
        deployed: false,
        version: '',
        status: 'not_deployed',
        lastDeploy: '',
        port: parseInt(port, 10) || 3001,
      },
    };

    const saved = await nodeManager.writeNodeWithPrivateKey(nodeConfig, sshPrivateKey);
    const safeSaved = { ...saved };
    if (saved.ssh) {
      safeSaved.ssh = { ...saved.ssh };
      delete safeSaved.ssh.password;
    }

    res.status(201).json({
      success: true,
      data: safeSaved,
      message: `节点 ${saved.name} 已添加`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('添加节点失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
