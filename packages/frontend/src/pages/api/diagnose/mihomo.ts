import type { NextApiRequest, NextApiResponse } from 'next';
import { mihomoAdapter } from '@/server/core';
import { logger } from '@/server/utils/logger';
import type { ApiResponse } from '@/server/types';

export const config = { maxDuration: 30 };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  try {
        const healthy = await mihomoAdapter.checkHealth();
    let version = 'unknown';
    let testResults: any = null;

    if (healthy) {
      try {
        const versionInfo = await mihomoAdapter.getVersion();
        version = versionInfo?.version || 'unknown';
      } catch (error) {
        logger.warn('获取 mihomo 版本失败:', error);
      }
      try {
        testResults = await mihomoAdapter.testConversion();
      } catch (error) {
        logger.warn('mihomo 转换测试失败:', error);
      }
    }

    res.status(healthy ? 200 : 503).json({
      success: healthy,
      data: { status: { healthy, version, testResults }, version, testResults },
      message: healthy ? 'Mihomo服务正常' : 'Mihomo服务异常',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('检查Mihomo服务API错误:', error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
}
