import type { NextApiRequest, NextApiResponse } from 'next';
import { yamlService } from '@/server/services/yamlService';
import { logger } from '@/server/utils/logger';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const fullConfig = yamlService.getFullConfig() || {};
    res.json({
      success: true,
      data: {
        app: fullConfig.app || {},
        network: fullConfig.network || {},
        external: fullConfig.external || {},
        protocols: fullConfig.protocols || {},
        cors: fullConfig.cors || {},
      },
    });
  } catch (error) {
    logger.error('获取前端配置失败:', error);
    res.status(500).json({ success: false, message: '获取前端配置过程中发生错误' });
  }
}
