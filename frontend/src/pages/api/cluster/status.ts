import type { NextApiRequest, NextApiResponse } from 'next';
import { nodeAggregation } from '@/server/core';
import type { ApiResponse } from '@/server/types';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
) {
  try {
    const clusterStatus = await nodeAggregation.getClusterStatus();
    res.json({
      success: true,
      data: clusterStatus,
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
