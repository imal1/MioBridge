import { createHmac } from 'node:crypto';
import { KERNEL_TYPES } from '../kernels/types.js';
import type { KernelRuntimeStatus, LogsResult, NodeConfig } from './types.js';

export interface AgentClientOptions { fetch?: typeof globalThis.fetch; timeoutMs?: number; now?: () => number }

/** Compatibility client for the public HTTP + HMAC Agent wire protocol. */
export class AgentClient {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  constructor(options: AgentClientOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  sign(node: NodeConfig, method: string, path: string, body = ''): Record<string, string> {
    if (node.host === 'localhost' || node.host === '127.0.0.1') return {};
    const timestamp = String(this.now());
    const signature = createHmac('sha256', node.secret || '').update(`${timestamp}\n${method}\n${path}\n${body}`).digest('hex');
    return { 'X-Node-Id': node.id, 'X-Timestamp': timestamp, 'X-Signature': signature };
  }

  async get(node: NodeConfig, path: string, timeoutMs = this.timeoutMs): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const port = node.port ?? node.agent?.port ?? 3001;
      const response = await this.fetcher(`http://${node.host}:${port}${path}`, {
        method: 'GET', headers: { 'Content-Type': 'application/json', ...this.sign(node, 'GET', path) }, signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return response.json();
    } finally { clearTimeout(timeout); }
  }

  validateKernelStatuses(value: unknown): KernelRuntimeStatus[] {
    if (!Array.isArray(value) || value.length !== KERNEL_TYPES.length) throw new Error('Agent 返回了无效的内核状态');
    const seen = new Set<string>();
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Agent 返回了无效的内核状态');
      const s = item as Record<string, unknown>;
      const keys = new Set(['type','detected','monitored','accessible','nodesCount','version','configPaths','error','binaryPath']);
      if (Object.keys(s).some(k => !keys.has(k)) || typeof s.type !== 'string' || !KERNEL_TYPES.includes(s.type as never) || seen.has(s.type) || typeof s.detected !== 'boolean' || typeof s.monitored !== 'boolean' || typeof s.accessible !== 'boolean' || !Number.isInteger(s.nodesCount) || (s.nodesCount as number) < 0 || !Array.isArray(s.configPaths) || !s.configPaths.every(p => typeof p === 'string') || (s.binaryPath !== undefined && typeof s.binaryPath !== 'string')) throw new Error('Agent 返回了无效的内核状态');
      seen.add(s.type);
    }
    if (KERNEL_TYPES.some(type => !seen.has(type))) throw new Error('Agent 返回了无效的内核状态');
    return value as KernelRuntimeStatus[];
  }

  async logs(node: NodeConfig, options: { file?: string; level?: string; query?: string } = {}): Promise<LogsResult> {
    const params = new URLSearchParams();
    if (options.file) params.set('file', options.file);
    if (options.level && options.level !== 'all') params.set('level', options.level);
    if (options.query) params.set('q', options.query);
    const json = await this.get(node, `/api/logs${params.size ? `?${params}` : ''}`) as Record<string, unknown>;
    const data = (json.data ?? json) as Record<string, unknown>;
    return { file: typeof data.file === 'string' ? data.file : options.file ?? 'journalctl', files: Array.isArray(data.files) ? data.files as string[] : ['journalctl'], lines: Array.isArray(data.lines) ? data.lines : [], updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(), nodeId: typeof data.nodeId === 'string' ? data.nodeId : node.id, nodeName: typeof data.nodeName === 'string' ? data.nodeName : node.name };
  }
}
