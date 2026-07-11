import type { NextApiRequest, NextApiResponse } from 'next';
import { DeployManager } from '@/server/services/deployManager';
import { logger } from '@/server/utils/logger';
import { KERNEL_TYPES, type ApiResponse, type KernelType } from '@/server/types';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed', timestamp: new Date().toISOString() });
  }

  try {
    const { kernelType } = req.body || {};
    if (!kernelType) {
      return res.status(400).json({ success: false, error: '缺少 kernelType', timestamp: new Date().toISOString() });
    }
    if (!KERNEL_TYPES.includes(kernelType as KernelType)) {
      return res.status(400).json({ success: false, error: `不支持的内核类型: ${kernelType}`, timestamp: new Date().toISOString() });
    }

    const cmd = DeployManager.getInstance().getKernelInstallCmd(kernelType);

    res.json({
      success: true,
      data: { command: cmd },
      message: `内核 ${kernelType} 安装任务已提交`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('内核安装失败:', error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
}
