import type { NextApiRequest, NextApiResponse } from 'next';
import { mioBridgeCore } from '@/server/core';
import { hmacVerify } from '@/server/middleware/hmac';
import type { ApiResponse } from '@/server/types';

// HMAC shared secret — only needed when this node receives requests from a control plane.
// Set via environment variable; absent → HMAC check is skipped.
const NODE_SECRET = process.env.MIOBRIDGE_NODE_SECRET || '';

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  // HMAC 验证（仅当配置了 NODE_SECRET 时生效）
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
    const status = await mioBridgeCore.getStatus();
    res.json({ success: true, data: status, timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
}
