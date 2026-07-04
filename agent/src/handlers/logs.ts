import type { AgentConfig } from '../config';
import { hmacVerify } from '../hmac';
import { execSync } from 'child_process';
import * as fs from 'fs';

interface IncomingRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

const LOG_FILES = ['journalctl', 'agent.log'];
const MAX_LINES = 800;

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function filterLines(lines: string[], level: string, query: string): string[] {
  let next = lines;
  if (level && level !== 'all') {
    const needle = level.toLowerCase();
    next = next.filter(line => line.toLowerCase().includes(needle));
  }
  if (query) {
    const needle = query.toLowerCase();
    next = next.filter(line => line.toLowerCase().includes(needle));
  }
  return next.slice(-MAX_LINES);
}

function readJournalLines(): string[] {
  try {
    const output = execSync('journalctl -u miobridge-agent -n 800 --no-pager --output=short-iso', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.split(/\r?\n/).filter(Boolean);
  } catch (error: any) {
    const message = error?.stderr || error?.message || 'journalctl unavailable';
    return [`journalctl 暂不可用: ${String(message).trim()}`];
  }
}

function readAgentLogLines(): string[] {
  const candidates = [
    '/var/log/miobridge-agent.log',
    '/etc/miobridge-agent/agent.log',
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    return content.split(/\r?\n/).filter(Boolean).slice(-MAX_LINES);
  }
  return ['agent.log 暂不可用'];
}

export async function handleLogs(
  req: IncomingRequest,
  config: AgentConfig,
): Promise<Response> {
  if (config.node.secret) {
    const { valid, error } = hmacVerify(req, config.node.secret);
    if (!valid) {
      return jsonResponse({ success: false, error: `认证失败: ${error}`, timestamp: new Date().toISOString() }, 401);
    }
  }

  const parsed = new URL(req.url || '/api/logs', 'http://agent.local');
  const requestedFile = parsed.searchParams.get('file') || 'journalctl';
  const file = LOG_FILES.includes(requestedFile) ? requestedFile : 'journalctl';
  const level = parsed.searchParams.get('level') || 'all';
  const query = parsed.searchParams.get('q') || '';

  const rawLines = file === 'agent.log' ? readAgentLogLines() : readJournalLines();
  const lines = filterLines(rawLines, level, query);

  return jsonResponse({
    success: true,
    data: {
      file,
      files: LOG_FILES,
      lines,
      updatedAt: new Date().toISOString(),
      nodeId: config.node.id,
      nodeName: config.node.name,
    },
    timestamp: new Date().toISOString(),
  });
}
