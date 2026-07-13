import type { NextApiRequest, NextApiResponse } from 'next';
import { NodeManager } from '@/server/services/nodeManager';
import { logger } from '@/server/utils/logger';
import type { ApiResponse } from '@/server/types';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
) {
  try {
    const nodeId = (req.query.node as string) || undefined;
    const result = await NodeManager.getInstance().triggerUpdate(nodeId);
    const successCount = Object.values(result.results).filter(r => r.success).length;
    const totalCount = Object.keys(result.results).length;
    res.json({
      success: successCount === totalCount,
      data: result,
      message: `${successCount}/${totalCount} 节点更新成功`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('集群更新失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
