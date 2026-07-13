import type { NextApiRequest, NextApiResponse } from 'next';
import { logger } from '@/server/utils/logger';
import type { ApiResponse } from '@/server/types';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed', timestamp: new Date().toISOString() });
  }

  try {
    const { nodeId } = req.body || {};
    res.json({
      success: true,
      message: `节点 ${nodeId} Agent 更新任务已提交`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Agent 更新失败:', error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
}
