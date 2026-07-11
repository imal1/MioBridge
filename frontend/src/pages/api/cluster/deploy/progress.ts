import type { NextApiRequest, NextApiResponse } from 'next';
import { getDeployStatus } from '@/server/services/deployProgressStore';
import type { ApiResponse } from '@/server/types';

/**
 * GET /api/cluster/deploy/progress?node=<nodeId>
 *
 * 单个节点部署进度（JSON 响应，替代旧 SSE 端点）。
 * 推荐使用新的聚合端点 GET /api/cluster/deploy/status 一次获取所有节点状态。
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method Not Allowed',
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const nodeId = (req.query.node as string) || '';
    if (!nodeId) {
      return res.status(400).json({
        success: false,
        error: '缺少 node 参数',
        timestamp: new Date().toISOString(),
      });
    }

    const status = await getDeployStatus(nodeId);
    if (!status) {
      return res.json({
        success: true,
        data: { status: null, message: '该节点没有进行中的部署' },
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      data: { status },
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
