import type { NextApiRequest, NextApiResponse } from 'next';
import { NodeManager } from '@/server/services/nodeManager';
import type { ApiResponse } from '@/server/types';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
) {
  try {
    const nodeId = (req.query.node as string) || undefined;
    const result = await NodeManager.getInstance().healthCheck(nodeId);
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
