import type { NextApiRequest, NextApiResponse } from 'next';
import { mihomoAdapter } from '@/server/core';
import { logger } from '@/server/utils/logger';
import type { ApiResponse } from '@/server/types';

export const config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: '10mb' } },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: '仅支持 POST', timestamp: new Date().toISOString() });
    return;
  }

  try {
    const { content } = req.body || {};

    if (!content || typeof content !== 'string') {
      logger.warn('内容转换请求缺少有效内容');
      res.status(400).json({ success: false, error: '请提供有效的订阅内容', timestamp: new Date().toISOString() });
      return;
    }

    logger.info(`收到内容转换请求，内容长度: ${content.length} 字符`);

        const mihomoAvailable = await mihomoAdapter.checkHealth();
    if (!mihomoAvailable) {
      logger.error('Mihomo 服务不可用');
      res.status(503).json({ success: false, error: 'Mihomo 服务不可用', timestamp: new Date().toISOString() });
      return;
    }

    const clashConfig = await mihomoAdapter.convertToClashByContent(content);
    logger.info(`转换成功，生成配置长度: ${clashConfig.length} 字符`);

    res.json({
      success: true,
      data: { clashConfig, originalLength: content.length, configLength: clashConfig.length },
      message: '转换成功',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('内容转换API错误:', { message: error.message, stack: error.stack, name: error.name });
    res.status(500).json({ success: false, error: `转换失败: ${error.message}`, timestamp: new Date().toISOString() });
  }
}
