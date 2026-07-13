import type { NextApiRequest, NextApiResponse } from 'next';
import { config as appConfig } from '@/server/config';
import { logger } from '@/server/utils/logger';
import type { ApiResponse, ConfigUpdateRequest } from '@/server/types';

export default function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method === 'POST') {
    try {
      const { configs }: ConfigUpdateRequest = req.body || {};

      if (!Array.isArray(configs)) {
        res.status(400).json({ success: false, error: '请提供有效的configs数组', timestamp: new Date().toISOString() });
        return;
      }
      if (configs.length === 0) {
        res.status(400).json({ success: false, error: '配置列表不能为空', timestamp: new Date().toISOString() });
        return;
      }

      appConfig.singBoxConfigs = configs;
      logger.info(`配置列表已更新: ${JSON.stringify(configs)}`);

      res.json({
        success: true,
        data: { configs: appConfig.singBoxConfigs, count: appConfig.singBoxConfigs.length },
        message: '配置列表更新成功',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
    }
    return;
  }

  // GET
  res.json({
    success: true,
    data: {
      configs: appConfig.singBoxConfigs,
      description: '当前配置的sing-box节点名称列表',
      count: appConfig.singBoxConfigs.length,
    },
    timestamp: new Date().toISOString(),
  });
}
