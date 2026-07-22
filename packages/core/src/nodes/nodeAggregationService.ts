import { dedupeProxySources, type CollectedProxySource } from '../artifacts/sources.js';
import { KERNEL_TYPES } from '../kernels/types.js';
import { AgentClient } from './agentClient.js';
import { NodeRepository } from './nodeRepository.js';
import type { StateStore } from '../state/stateStore.js';
import type { ClusterStatus, KernelRuntimeStatus, NodeConfig, NodeStatus } from './types.js';

export interface RemoteSourceCollection { sources: CollectedProxySource[]; errors: string[] }

const LAST_ERROR_PREFIX = 'node-last-error/';

export class NodeAggregationService {
  private readonly cache = new Map<string, NodeStatus>();
  /** 已经从持久化存储回填过 lastError 的节点，避免每次轮询都读一次。 */
  private readonly hydrated = new Set<string>();
  /** 集群状态是一次对全部节点的实时扇出，多个端点（status/health/metrics/components…）
   *  会同时轮询它。缓存 + in-flight 去重 + stale-while-revalidate 让状态端点
   *  永不阻塞在实时扇出上：有旧快照即刻返回、过期后台刷新，只有冷启动才真跑，
   *  且冷启动的每节点探测超时很短，绝不把 HTTP 请求拖到前端超时。 */
  private readonly statusTtlMs: number;
  /** 状态扇出的每节点探测超时。刻意远短于 AgentClient 默认的 10s（部署/日志用），
   *  这样即便某节点不可达，冷启动也能快速兜底返回而非拖满整条请求。 */
  private readonly statusProbeTimeoutMs: number;
  private readonly now: () => number;
  private statusCache: { at: number; value: ClusterStatus } | undefined;
  private statusInFlight: Promise<ClusterStatus> | undefined;
  constructor(
    private readonly repository: NodeRepository,
    private readonly agent: AgentClient,
    /** 可选：提供后「最近错误」可以跨进程重启保留。 */
    private readonly state?: StateStore,
    options: { statusTtlMs?: number; statusProbeTimeoutMs?: number; now?: () => number } = {},
  ) {
    this.statusTtlMs = options.statusTtlMs ?? 2_000;
    this.statusProbeTimeoutMs = options.statusProbeTimeoutMs ?? 5_000;
    this.now = options.now ?? Date.now;
  }
  getNodeCache(): ReadonlyMap<string, NodeStatus> { return this.cache; }

  private async loadLastError(nodeId: string): Promise<string | undefined> {
    const cached = this.cache.get(nodeId)?.lastError;
    if (cached !== undefined) return cached;
    if (!this.state || this.hydrated.has(nodeId)) return undefined;
    this.hydrated.add(nodeId);
    try { return (await this.state.get(`${LAST_ERROR_PREFIX}${nodeId}`)) ?? undefined; }
    catch { return undefined; }
  }

  private async persistLastError(nodeId: string, message: string): Promise<void> {
    this.hydrated.add(nodeId);
    if (!this.state) return;
    try { await this.state.set(`${LAST_ERROR_PREFIX}${nodeId}`, message); }
    catch { /* 「最近错误」是诊断信息，写不进去也不能影响状态聚合本身。 */ }
  }

  async collectRemoteNodeSources(): Promise<RemoteSourceCollection> {
    const nodes = await this.repository.list();
    const results = await Promise.all(nodes.map(node => this.collectSources(node)));
    return { sources: results.flatMap(r => r.sources), errors: results.flatMap(r => r.errors) };
  }

  async getClusterStatus(options: { forceRefresh?: boolean } = {}): Promise<ClusterStatus> {
    const cached = this.statusCache;
    if (!options.forceRefresh && cached) {
      // stale-while-revalidate：立刻回上次快照，过期就丢一个后台刷新。
      // 请求线程绝不等待实时扇出，故任何慢节点都无法把响应拖到前端超时。
      if (this.now() - cached.at >= this.statusTtlMs) this.refreshInBackground();
      return cached.value;
    }
    // 冷启动（尚无任何快照）或强制刷新：这次必须真跑，但每节点探测超时很短。
    return this.runClusterStatus();
  }

  /** 过期后台刷新：不阻塞任何调用方，错误吞掉（下次探测会再试），避免 unhandled rejection。 */
  private refreshInBackground(): void {
    if (this.statusInFlight) return;
    this.runClusterStatus().catch(() => undefined);
  }

  /** 真正跑一次扇出。并发调用复用同一个 in-flight，成功后写入缓存。 */
  private runClusterStatus(): Promise<ClusterStatus> {
    if (this.statusInFlight) return this.statusInFlight;
    const run = this.computeClusterStatus()
      .then(value => { this.statusCache = { at: this.now(), value }; return value; })
      .finally(() => { if (this.statusInFlight === run) this.statusInFlight = undefined; });
    this.statusInFlight = run;
    return run;
  }

  private async computeClusterStatus(): Promise<ClusterStatus> {
    const nodes = await this.repository.list({ enabledOnly: false });
    const enabledNodes = nodes.filter(node => node.enabled);
    const [statuses, collection] = await Promise.all([Promise.all(nodes.map(node => this.status(node, this.statusProbeTimeoutMs))), Promise.all(enabledNodes.map(node => this.collectSources(node, this.statusProbeTimeoutMs)))]);
    const sources = collection.flatMap(result => result.sources);
    return { totalNodes: statuses.length, onlineNodes: statuses.filter(s => s.online).length, totalProxies: dedupeProxySources(sources).length, nodes: statuses, lastUpdated: new Date().toISOString() };
  }

  private async collectSources(node: NodeConfig, timeoutMs?: number): Promise<RemoteSourceCollection> {
    try {
      const json = await this.agent.get(node, '/api/urls', timeoutMs) as Record<string, unknown>;
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

  private async status(node: NodeConfig, timeoutMs?: number): Promise<NodeStatus> {
    const base: NodeStatus = {
      nodeId: node.id, name: node.name, host: node.host, configuredKernels: node.kernels,
      kernels: unavailable(node.kernels), location: node.location, enabled: node.enabled,
      ...(node.tags?.length ? { tags: node.tags } : {}),
      online: false, ...(node.agent ? { agent: node.agent } : {}),
      ...(node.ssh ? { sshUser: node.ssh.user, sshPort: node.ssh.port ?? 22, sshHostKey: node.ssh.hostKey, sshAuthMethod: node.ssh.authMethod } : {}),
    };
    // 「最近错误」必须跨越恢复继续可见：节点重新在线后 error 会消失，
    // 但用户仍需要看到上一次失败的原因才能判断要不要进排障链路。
    const previousError = await this.loadLastError(node.id);
    try {
      const json = await this.agent.get(node, '/api/status', timeoutMs) as Record<string, unknown>;
      const data = (json.data ?? json) as Record<string, unknown>;
      const kernels = this.agent.validateKernelStatuses(data.kernels);
      const kernelError = kernels.find(kernel => kernel.error)?.error;
      if (kernelError && kernelError !== previousError) await this.persistLastError(node.id, kernelError);
      const lastError = kernelError ?? previousError;
      const observedVersion = typeof data.version === 'string' ? data.version : undefined;
      const observedAgent = node.agent ? {
        ...node.agent,
        deployed: true,
        status: 'running' as const,
        version: observedVersion ?? node.agent.version,
      } : undefined;
      // Manual/bootstrap installation can make Agent reachable before the control-plane
      // snapshot is updated. Reconcile that fact so deployment and later pages agree.
      if (observedAgent && (!node.agent?.deployed || node.agent.status !== 'running' || node.agent.version !== observedAgent.version)) {
        await this.repository.update(node.id, current => ({ ...current, agent: observedAgent })).catch(() => undefined);
      }
      // Agent 已装、可被检测，但尚未纳入监控的内核 = 「打通后可提示纳管」的候选。
      const adoptableKernels = kernels.filter(kernel => kernel.detected && !kernel.monitored).map(kernel => kernel.type);
      const status: NodeStatus = { ...base, online: true, kernels, nodesCount: kernels.reduce((sum,k) => sum+k.nodesCount, 0), ...(lastError ? { lastError } : {}), ...(observedAgent ? { agent: observedAgent } : {}), ...(observedVersion ? { version: observedVersion } : {}), ...(typeof data.uptime === 'number' ? { uptime: data.uptime } : {}), ...(typeof data.mihomoAvailable === 'boolean' ? { mihomoAvailable: data.mihomoAvailable } : {}), ...(typeof data.mihomoVersion === 'string' ? { mihomoVersion: data.mihomoVersion } : {}), ...(adoptableKernels.length ? { adoptableKernels } : {}) };
      this.cache.set(node.id, status); return status;
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError' ? '请求超时' : `连接失败: ${error instanceof Error ? error.message : String(error)}`;
      await this.persistLastError(node.id, message);
      const status = { ...base, error: message, lastError: message };
      this.cache.set(node.id, status); return status;
    }
  }
  private error(node: NodeConfig, message: string): string { return `节点 ${node.name} (${node.id}): ${message}`; }
}

function unavailable(configured: NodeConfig['kernels']): KernelRuntimeStatus[] {
  const byType = new Map(configured.map(k => [k.type, k]));
  return KERNEL_TYPES.map(type => ({ type, detected: false, monitored: byType.has(type), accessible: false, nodesCount: 0, configPaths: byType.get(type)?.configPath ? [byType.get(type)!.configPath!] : [] }));
}
