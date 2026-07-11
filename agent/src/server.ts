import { createServer, IncomingMessage, ServerResponse } from 'http';
import { loadConfig } from './config';
import { handleStatus } from './handlers/status';
import { handleUpdate } from './handlers/update';
import { handleHealth } from './handlers/health';
import { handleUrls } from './handlers/urls';
import { handleLogs } from './handlers/logs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_PATH = process.env.MIOBRIDGE_AGENT_CONFIG ||
  path.join(os.homedir(), '.config', 'miobridge-agent', 'agent.yaml');

async function main() {
  console.log('MioBridge Agent starting...');
  const config = await loadConfig(CONFIG_PATH);
  console.log(`Config loaded: node=${config.node.id}, kernels=${config.kernels.map(item => item.type).join(',')}, port=${config.port}`);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '/';

    try {
      if (url === '/api/status') {
        const response = await handleStatus(req, config);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      } else if (url === '/api/update') {
        const response = await handleUpdate(req, config);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      } else if (url === '/api/urls') {
        const response = handleUrls(req, config);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      } else if (url.startsWith('/api/logs')) {
        const response = await handleLogs(req, config);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      } else if (url === '/api/health' || url === '/health') {
        const response = handleHealth(req, config);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`MioBridge Agent listening on port ${config.port}`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    server.close(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down...');
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('Agent failed to start:', err);
  process.exit(1);
});
