import { createHmac } from 'node:crypto';
import { KERNEL_TYPES } from '../kernels/types.js';
import type { KernelRuntimeStatus, LogsResult, NodeConfig } from './types.js';

export interface AgentClientOptions { fetch?: typeof globalThis.fetch; timeoutMs?: number; now?: () => number }

/**
 * 凭据形状的字段名。这些校验器原本用「未知字段一律拒绝」来兼任泄露探测器，
 * 副作用是服务端任何一次向后兼容的字段扩展都会让整块功能静默退化。
 * 现在改为：良性未知字段忽略（并在重建时剥掉），凭据形状的字段仍然硬拒。
 */
const SENSITIVE_KEY = /password|passphrase|secret|token|credential|privatekey|apikey|authorization/i;

export function hasSensitiveKey(candidate: Record<string, unknown>): boolean {
  return Object.keys(candidate).some(key => SENSITIVE_KEY.test(key));
}

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
    const seen = new Map<string, KernelRuntimeStatus>();
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Agent 返回了无效的内核状态');
      const s = item as Record<string, unknown>;
      if (hasSensitiveKey(s) || typeof s.type !== 'string' || !KERNEL_TYPES.includes(s.type as never) || seen.has(s.type) || typeof s.detected !== 'boolean' || typeof s.monitored !== 'boolean' || typeof s.accessible !== 'boolean' || !Number.isInteger(s.nodesCount) || (s.nodesCount as number) < 0 || !Array.isArray(s.configPaths) || !s.configPaths.every(p => typeof p === 'string') || (s.version !== undefined && typeof s.version !== 'string') || (s.error !== undefined && typeof s.error !== 'string') || (s.binaryPath !== undefined && typeof s.binaryPath !== 'string')) throw new Error('Agent 返回了无效的内核状态');
      // 重建而不是原样透传：未知字段不再导致整体拒绝，因此必须在这里剥掉，
      // 否则它们会顺着 NodeStatus.kernels 直接出现在 /api/cluster/status 响应里。
      seen.set(s.type, {
        type: s.type as KernelRuntimeStatus['type'],
        detected: s.detected, monitored: s.monitored, accessible: s.accessible,
        nodesCount: s.nodesCount as number,
        configPaths: [...s.configPaths as string[]],
        ...(s.version !== undefined ? { version: s.version as string } : {}),
        ...(s.binaryPath !== undefined ? { binaryPath: s.binaryPath as string } : {}),
        ...(s.error !== undefined ? { error: s.error as string } : {}),
      });
    }
    return KERNEL_TYPES.map(type => {
      const status = seen.get(type);
      if (!status) throw new Error('Agent 返回了无效的内核状态');
      return status;
    });
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
