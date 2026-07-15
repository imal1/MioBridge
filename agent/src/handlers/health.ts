import type { AgentConfig } from '../config';
import { hmacVerify } from '../hmac';
import { AGENT_VERSION } from '../version';

interface IncomingRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

export function handleHealth(
  req: IncomingRequest,
  config: AgentConfig,
): Response {
  if (config.node.secret) {
    const { valid, error } = hmacVerify(req, config.node.secret);
    if (!valid) {
      return new Response(
        JSON.stringify({ status: 'unhealthy', error: `认证失败: ${error}`, timestamp: new Date().toISOString() }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  return new Response(
    JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: AGENT_VERSION,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
