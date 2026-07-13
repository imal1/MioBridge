import type { NextApiRequest, NextApiResponse } from 'next';
import { getAllDeployStatuses, getDeployStatus } from '@/server/services/deployProgressStore';
import type { ApiResponse, DeployStatus } from '@/server/types';

/**
 * GET /api/cluster/deploy/status?nodes=id1,id2,id3
 *
 * 聚合部署进度端点 — 替代旧的 SSE 轮询伪装。
 * 不传 nodes 参数时返回所有进行中的部署。
 *
 * 响应：
 * {
 *   "success": true,
 *   "data": {
 *     "deployments": { "nodeId": DeployStatus, ... },
 *     "timestamp": "2026-06-28T17:30:00Z"
 *   }
 * }
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
    const nodesParam = (req.query.nodes as string) || '';
    const requestedNodes = nodesParam ? nodesParam.split(',').map(s => s.trim()).filter(Boolean) : [];

    let deployments: Record<string, DeployStatus>;
    if (requestedNodes.length > 0) {
      deployments = {};
      for (const nodeId of requestedNodes) {
        const status = await getDeployStatus(nodeId);
        if (status) {
          deployments[nodeId] = status;
        }
      }
    } else {
      const allStatuses = await getAllDeployStatuses();
      deployments = {};
      for (const status of allStatuses) {
        deployments[status.nodeId] = status;
      }
    }

    res.json({
      success: true,
      data: {
        deployments,
        timestamp: new Date().toISOString(),
      },
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
