import type { NextApiRequest, NextApiResponse } from 'next';
import { yamlService } from '@/server/services/yamlService';
import { logger } from '@/server/utils/logger';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const config = yamlService.getFullConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    logger.error('获取完整配置失败:', error);
    res.status(500).json({ success: false, message: '获取配置过程中发生错误' });
  }
}
