import { parse, stringify } from 'yaml';
import type { StateStore } from '../state/stateStore.js';
import type { NodeConfig, NodeKernelConfig } from './types.js';
import { KERNEL_TYPES, type KernelType } from '../kernels/types.js';

const NODES_KEY = 'nodes.yaml';

export function validateNodeKernels(value: unknown, allowEmpty = true): NodeKernelConfig[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error('至少选择一个内核');
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('内核配置无效');
    const candidate = item as Record<string, unknown>;
    if (Object.keys(candidate).some(key => key !== 'type' && key !== 'configPath')) throw new Error('内核配置包含未知字段');
    if (typeof candidate.type !== 'string' || !KERNEL_TYPES.includes(candidate.type as KernelType)) throw new Error(`不支持的内核类型: ${String(candidate.type ?? '')}`);
    if (seen.has(candidate.type)) throw new Error(`内核类型重复: ${candidate.type}`);
    if (candidate.configPath !== undefined && (typeof candidate.configPath !== 'string' || !/^\/[A-Za-z0-9/._@+-]+$/.test(candidate.configPath))) throw new Error(`内核配置路径无效: ${candidate.type}`);
    seen.add(candidate.type);
    return { type: candidate.type as KernelType, ...(candidate.configPath ? { configPath: candidate.configPath } : {}) };
  }).sort((a, b) => KERNEL_TYPES.indexOf(a.type) - KERNEL_TYPES.indexOf(b.type));
}

/** Persistence-only node registry; callers own deployment and SSH operations. */
export class NodeRepository {
  constructor(private readonly store: StateStore, private readonly key = NODES_KEY) {}

  async list(options: { enabledOnly?: boolean } = {}): Promise<NodeConfig[]> {
    const raw = await this.store.get(this.key);
    if (raw === null) return [];
    const document = parse(raw) as { nodes?: unknown } | null;
    if (!document || !Array.isArray(document.nodes)) throw new Error('nodes.yaml 必须包含 nodes 数组');
    const nodes = document.nodes.map(value => this.normalize(value));
    return options.enabledOnly === false ? nodes : nodes.filter(node => node.enabled);
  }

  async save(nodes: NodeConfig[]): Promise<void> {
    await this.store.set(this.key, stringify({ nodes: nodes.map(node => this.normalize(node)) }, { lineWidth: 0 }));
  }

  async update(nodeId: string, update: (node: NodeConfig) => NodeConfig | void): Promise<NodeConfig> {
    return this.store.withLock(this.key, async () => {
      const nodes = await this.list({ enabledOnly: false });
      const index = nodes.findIndex(node => node.id === nodeId);
      if (index < 0) throw new Error(`节点 ${nodeId} 不存在`);
      const current = nodes[index]!;
      nodes[index] = this.normalize(update(current) ?? current);
      await this.save(nodes);
      return nodes[index];
    });
  }

  private normalize(value: unknown): NodeConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('节点配置无效');
    const node = value as Partial<NodeConfig>;
    if (!node.id || !node.name || !node.host) throw new Error('节点缺少 id、name 或 host');
    return {
      id: node.id, name: node.name, host: node.host, port: node.port ?? node.agent?.port ?? 3001,
      secret: node.secret ?? '', kernels: validateNodeKernels(node.kernels),
      location: node.location ?? '', enabled: node.enabled !== false,
      ...(normalizeTags(node.tags).length ? { tags: normalizeTags(node.tags) } : {}),
      ...(node.ssh ? { ssh: node.ssh } : {}), ...(node.agent ? { agent: node.agent } : {}),
    };
  }
}

function normalizeTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('节点标签必须是数组');
  const tags = value.map(item => {
    if (typeof item !== 'string' || !item.trim() || item.trim().length > 48) throw new Error('节点标签必须是 1 到 48 个字符');
    return item.trim();
  });
  return [...new Set(tags)].slice(0, 20);
}
