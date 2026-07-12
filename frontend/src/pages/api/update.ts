import type { NextApiRequest, NextApiResponse } from 'next';
import { mioBridgeCore } from '@/server/core';
import { hmacVerify } from '@/server/middleware/hmac';
import { logger } from '@/server/utils/logger';
import type { ApiResponse } from '@/server/types';

export const config = {
  // 订阅更新会 spawn mihomo/sing-box，耗时较长
  maxDuration: 120,
};

const NODE_SECRET = process.env.MIOBRIDGE_NODE_SECRET || '';

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  // HMAC 验证
  if (NODE_SECRET) {
    const { valid, error } = hmacVerify(req, NODE_SECRET);
    if (!valid) {
      return res.status(401).json({
        success: false,
        error: `认证失败: ${error}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  try {
    const result = await mioBridgeCore.updateSubscription();
    res.json({ success: true, data: result, message: '订阅更新成功', timestamp: new Date().toISOString() });
  } catch (error: any) {
    logger.error('更新订阅API错误:', error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
}
