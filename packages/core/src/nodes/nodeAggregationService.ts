import { dedupeProxySources, type CollectedProxySource } from '../artifacts/sources.js';
import { KERNEL_TYPES } from '../kernels/types.js';
import { AgentClient } from './agentClient.js';
import { isLocalNode, NodeRepository } from './nodeRepository.js';
import type { ClusterStatus, KernelRuntimeStatus, NodeConfig, NodeStatus } from './types.js';

export interface RemoteSourceCollection { sources: CollectedProxySource[]; errors: string[] }
export interface LocalNodeMonitor { status(node: NodeConfig): Promise<NodeStatus> }

export class NodeAggregationService {
  private readonly cache = new Map<string, NodeStatus>();
  constructor(
    private readonly repository: NodeRepository,
    private readonly agent: AgentClient,
    private readonly local?: LocalNodeMonitor,
  ) {}
  getNodeCache(): ReadonlyMap<string, NodeStatus> { return this.cache; }

  async collectRemoteNodeSources(): Promise<RemoteSourceCollection> {
    const nodes = (await this.repository.list()).filter(node => !isLocalNode(node));
    const results = await Promise.all(nodes.map(node => this.collectSources(node)));
    return { sources: results.flatMap(r => r.sources), errors: results.flatMap(r => r.errors) };
  }

  async getClusterStatus(): Promise<ClusterStatus> {
    const nodes = await this.repository.list();
    const statuses = await Promise.all(nodes.map(node => isLocalNode(node) ? this.localStatus(node) : this.status(node)));
    const childNodes = nodes.filter(node => !isLocalNode(node));
    const collection = await Promise.all(childNodes.map(node => this.collectSources(node)));
    const childSources = dedupeProxySources(collection.flatMap(result => result.sources));
    const localProxies = statuses.filter(status => status.kind === 'local').reduce((sum, status) => sum + (status.nodesCount ?? 0), 0);
    return {
      totalNodes: statuses.length,
      onlineNodes: statuses.filter(status => status.online).length,
      totalProxies: localProxies + childSources.length,
      localNodes: statuses.filter(status => status.kind === 'local').length,
      childNodes: statuses.filter(status => status.kind !== 'local').length,
      nodes: statuses,
      lastUpdated: new Date().toISOString(),
    };
  }

  private async localStatus(node: NodeConfig): Promise<NodeStatus> {
    if (!this.local) {
      return { nodeId: node.id, name: node.name, kind: 'local', configuredKernels: node.kernels, kernels: unavailable(node.kernels), location: node.location, online: false, listener: { deployed: false, listening: false, error: '本机节点监视器不可用' }, error: '本机节点监视器不可用' };
    }
    try {
      const status = { ...await this.local.status(node), listener: { deployed: true, listening: true } };
      this.cache.set(node.id, status);
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status: NodeStatus = { nodeId: node.id, name: node.name, kind: 'local', configuredKernels: node.kernels, kernels: unavailable(node.kernels), location: node.location, online: false, listener: { deployed: true, listening: false, error: message }, error: message };
      this.cache.set(node.id, status);
      return status;
    }
  }

  private async collectSources(node: NodeConfig): Promise<RemoteSourceCollection> {
    try {
      const json = await this.agent.get(node, '/api/urls') as Record<string, unknown>;
      const data = (json.data ?? json) as Record<string, unknown>;
      const kernels = this.agent.validateKernelStatuses(data.kernels);
      if (!Array.isArray(data.sources)) throw new Error('Agent 返回了无效的代理来源');
      const sources = data.sources.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Agent 返回了无效的代理来源');
        const source = item as Record<string, unknown>;
        if (Object.keys(source).some(k => k !== 'kernel' && k !== 'url') || typeof source.kernel !== 'string' || !KERNEL_TYPES.includes(source.kernel as never) || typeof source.url !== 'string' || !source.url) throw new Error('Agent 返回了无效的代理来源');
        return source as { kernel: typeof KERNEL_TYPES[number]; url: string };
      });
      if (new Set(sources.map(s => s.url)).size !== sources.length) throw new Error('Agent 返回了重复的代理来源');
      const byType = new Map(kernels.map(kernel => [kernel.type, kernel]));
      for (const source of sources) {
        const kernel = byType.get(source.kernel);
        if (!kernel || !kernel.monitored || !kernel.accessible) {
          throw new Error(`Agent 来源引用了未监控或不可访问的内核: ${source.kernel}`);
        }
      }
      for (const kernel of kernels) if (sources.filter(s => s.kernel === kernel.type).length !== kernel.nodesCount) throw new Error(`Agent 内核 ${kernel.type} 的来源数量与 nodesCount 不一致`);
      return { sources: sources.sort((a,b) => KERNEL_TYPES.indexOf(a.kernel)-KERNEL_TYPES.indexOf(b.kernel)).map(s => ({ ...s, nodeId: node.id, location: node.location })), errors: kernels.filter(k => (k.monitored && !k.accessible) || k.error).map(k => this.error(node, `内核 ${k.type}: ${k.error || '已监控但不可访问'}`)) };
    } catch (error) { return { sources: [], errors: [this.error(node, error instanceof Error ? error.message : String(error))] }; }
  }

  private async status(node: NodeConfig): Promise<NodeStatus> {
    const base: NodeStatus = { nodeId: node.id, name: node.name, kind: 'child', configuredKernels: node.kernels, kernels: unavailable(node.kernels), location: node.location, online: false, listener: { deployed: Boolean(node.agent?.deployed), listening: false, ...(!node.agent?.deployed ? { error: 'Agent 未部署' } : {}) }, ...(node.agent ? { agent: node.agent } : {}) };
    try {
      const json = await this.agent.get(node, '/api/status') as Record<string, unknown>;
      const data = (json.data ?? json) as Record<string, unknown>;
      const kernels = this.agent.validateKernelStatuses(data.kernels);
      const status: NodeStatus = { ...base, online: true, listener: { deployed: true, listening: true }, kernels, nodesCount: kernels.reduce((sum,k) => sum+k.nodesCount, 0), ...(typeof data.version === 'string' ? { version: data.version } : {}), ...(typeof data.uptime === 'number' ? { uptime: data.uptime } : {}) };
      this.cache.set(node.id, status); return status;
    } catch (error) { const status = { ...base, error: error instanceof Error && error.name === 'AbortError' ? '请求超时' : `连接失败: ${error instanceof Error ? error.message : String(error)}` }; this.cache.set(node.id, status); return status; }
  }
  private error(node: NodeConfig, message: string): string { return `节点 ${node.name} (${node.id}): ${message}`; }
}

function unavailable(configured: NodeConfig['kernels']): KernelRuntimeStatus[] {
  const byType = new Map(configured.map(k => [k.type, k]));
  return KERNEL_TYPES.map(type => ({ type, detected: false, monitored: byType.has(type), accessible: false, nodesCount: 0, configPaths: byType.get(type)?.configPath ? [byType.get(type)!.configPath!] : [] }));
}
