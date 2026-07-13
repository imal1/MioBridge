import type { NextApiRequest, NextApiResponse } from 'next'
import { NodeManager } from '@/server/services/nodeManager'
import type { ApiResponse, LogsResult } from '@/server/types'

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse<LogsResult>>) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed', timestamp: new Date().toISOString() })
  }

  const nodeId = typeof req.query.node === 'string' ? req.query.node.trim() : ''
  if (!nodeId) {
    return res.status(400).json({
      success: false,
      error: '请选择一个子节点查看日志',
      timestamp: new Date().toISOString(),
    })
  }

  try {
    const data = await NodeManager.getInstance().getRemoteLogs(nodeId, {
      file: typeof req.query.file === 'string' ? req.query.file : undefined,
      level: typeof req.query.level === 'string' ? req.query.level : undefined,
      query: typeof req.query.q === 'string' ? req.query.q : undefined,
    })
    return res.json({ success: true, data, timestamp: new Date().toISOString() })
  } catch (error: any) {
    return res.status(502).json({
      success: false,
      error: error?.message || '读取子节点日志失败',
      timestamp: new Date().toISOString(),
    })
  }
}
