import { createServer, IncomingMessage, ServerResponse } from 'http';
import { checkConfig } from './config';
import { handleStatus } from './handlers/status';
import { handleUpdate } from './handlers/update';
import { handleHealth } from './handlers/health';
import { handleUrls } from './handlers/urls';
import { handleLogs } from './handlers/logs';
import { AGENT_VERSION } from './version';
import { AgentArgumentError, parseAgentArguments } from './cli';

async function main() {
  const command = parseAgentArguments(process.argv.slice(2));
  if (command.kind === 'version') {
    process.stdout.write(`${AGENT_VERSION}\n`);
    return;
  }
  if (command.kind === 'check-config') {
    await checkConfig(command.configPath);
    process.stdout.write(`Agent configuration is valid: ${command.configPath}\n`);
    return;
  }
  console.log('MioBridge Agent starting...');
  const config = await checkConfig(command.configPath);
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
  process.exit(err instanceof AgentArgumentError ? 2 : 1);
});
