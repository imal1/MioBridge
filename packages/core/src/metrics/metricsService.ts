import type { StatusInfo } from '../status/statusService.js';
import type { StateStore } from '../state/stateStore.js';

export interface ClusterMetricsSource {
  snapshot(): Promise<{ enabledNodes: number; onlineNodes: number; sources: number }>;
}

export interface ArtifactMetric {
  readonly exists: boolean;
  readonly ageSeconds?: number;
  readonly size?: number;
}

export interface MetricsSnapshot {
  readonly timestamp: string;
  readonly version: string;
  readonly uptime: number;
  readonly enabledNodes: number;
  readonly onlineNodes: number;
  readonly sources: number;
  readonly proxies: number;
  readonly mihomoAvailable: boolean;
  readonly artifacts: {
    readonly raw: ArtifactMetric;
    readonly subscription: ArtifactMetric;
    readonly clash: ArtifactMetric;
  };
  readonly lastGeneration?: {
    readonly status: 'success' | 'partial' | 'failed';
    readonly timestamp: string;
    readonly durationMs?: number;
  };
}

export class MetricsService {
  constructor(
    private readonly status: () => Promise<StatusInfo>,
    private readonly state: StateStore,
    private readonly cluster?: ClusterMetricsSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async snapshot(): Promise<MetricsSnapshot> {
    const [status, cluster, last] = await Promise.all([
      this.status(),
      this.cluster?.snapshot() ?? Promise.resolve({ enabledNodes: 0, onlineNodes: 0, sources: 0 }),
      this.state.get('artifact-state/last-update.json'),
    ]);
    const now = this.now();
    const age = (date?: string) => date ? Math.max(0, Math.floor((now.getTime() - Date.parse(date)) / 1000)) : undefined;
    const rawAge = age(status.rawLastUpdated);
    const subscriptionAge = age(status.subscriptionLastUpdated);
    const clashAge = age(status.clashLastUpdated);
    const generation = parseGeneration(last);
    return {
      timestamp: now.toISOString(), version: status.version, uptime: status.uptime,
      enabledNodes: cluster.enabledNodes, onlineNodes: cluster.onlineNodes,
      sources: cluster.sources, proxies: status.nodesCount ?? 0,
      mihomoAvailable: status.mihomoAvailable,
      artifacts: {
        raw: {
          exists: status.rawExists,
          ...(rawAge !== undefined ? { ageSeconds: rawAge } : {}),
          ...(status.rawSize !== undefined ? { size: status.rawSize } : {}),
        },
        subscription: {
          exists: status.subscriptionExists,
          ...(subscriptionAge !== undefined ? { ageSeconds: subscriptionAge } : {}),
          ...(status.subscriptionSize !== undefined ? { size: status.subscriptionSize } : {}),
        },
        clash: {
          exists: status.clashExists,
          ...(clashAge !== undefined ? { ageSeconds: clashAge } : {}),
          ...(status.clashSize !== undefined ? { size: status.clashSize } : {}),
        },
      },
      ...(generation ? { lastGeneration: generation } : {}),
    };
  }
}

function parseGeneration(raw: string | null): MetricsSnapshot['lastGeneration'] | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if ((value.status !== 'success' && value.status !== 'partial' && value.status !== 'failed') || typeof value.timestamp !== 'string') return undefined;
    return {
      status: value.status,
      timestamp: value.timestamp,
      ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}),
    };
  } catch { return undefined; }
}
