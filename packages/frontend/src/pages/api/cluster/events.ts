import type { NextApiRequest, NextApiResponse } from 'next';
import { NodeManager } from '@/server/services/nodeManager';

const SSE_INTERVAL_MS = 30_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial heartbeat comment
  res.write(': heartbeat\n\n');

  // Send initial cluster status
  try {
    const cluster = await NodeManager.getInstance().getClusterStatus();
    res.write(`data: ${JSON.stringify(cluster)}\n\n`);
  } catch {
    res.write(`data: ${JSON.stringify({ error: '获取集群状态失败' })}\n\n`);
  }

  // Periodic updates
  const interval = setInterval(async () => {
    try {
      const cluster = await NodeManager.getInstance().getClusterStatus();
      res.write(`data: ${JSON.stringify(cluster)}\n\n`);
    } catch {
      // silently skip failed updates to keep connection alive
      res.write(': heartbeat\n\n');
    }
  }, SSE_INTERVAL_MS);

  // Cleanup on client disconnect
  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
}
