import type { NextApiRequest, NextApiResponse } from 'next';
import { VERSION } from '@/server/version';
import { hmacVerify } from '@/server/middleware/hmac';

const NODE_SECRET = process.env.MIOBRIDGE_NODE_SECRET || '';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // HMAC 验证
  if (NODE_SECRET) {
    const { valid, error } = hmacVerify(req, NODE_SECRET);
    if (!valid) {
      return res.status(401).json({
        status: 'unhealthy',
        error: `认证失败: ${error}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  try {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: VERSION,
    });
  } catch (error: any) {
    res.status(503).json({ status: 'unhealthy', error: error.message, timestamp: new Date().toISOString() });
  }
}
