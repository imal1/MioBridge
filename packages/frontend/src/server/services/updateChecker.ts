import { EventEmitter } from 'events';
import type { NodeConfig } from '../types';

export interface UpdateCheckerOptions {
  checkIntervalMs: number;
  githubToken?: string;
}

export interface ReleaseInfo {
  latestVersion: string;
  downloadUrl: string;
  outdatedNodes: NodeConfig[];
  outdatedCount: number;
}

export interface UpdateCheckerEvents {
  updateAvailable: ReleaseInfo;
}

export interface NodeManagerLike {
  listNodes(): NodeConfig[];
  getNode(id: string): NodeConfig | null;
  updateNode(id: string, updates: Partial<NodeConfig>): NodeConfig | null;
}

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/imal1/MioBridge/releases/latest';

export class UpdateChecker extends EventEmitter {
  private nodeManager: NodeManagerLike;
  private options: UpdateCheckerOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(nodeManager: NodeManagerLike, options: UpdateCheckerOptions) {
    super();
    this.nodeManager = nodeManager;
    this.options = {
      checkIntervalMs: options.checkIntervalMs || 3600000,
      githubToken: options.githubToken || process.env.GITHUB_TOKEN,
    };
  }

  on<K extends keyof UpdateCheckerEvents>(event: K, listener: (arg: UpdateCheckerEvents[K]) => void): this {
    return super.on(event, listener);
  }

  emit<K extends keyof UpdateCheckerEvents>(event: K, arg: UpdateCheckerEvents[K]): boolean {
    return super.emit(event, arg);
  }

  async checkForUpdates(): Promise<ReleaseInfo | null> {
    try {
      const release = await this.fetchLatestRelease();
      if (!release) return null;

      const { tag_name, assets } = release;
      const agentAsset = assets.find(
        (a: { name: string; browser_download_url: string }) => a.name === 'miobridge-agent'
      );

      if (!agentAsset) return null;

      const nodes = this.nodeManager.listNodes();
      const outdatedNodes = nodes.filter((node) => {
        // 只检查已部署 agent 的节点（有 version 才比较）
        if (!node.ssh) return false;
        if (!node.agent?.version) return false;
        return node.agent.version !== tag_name;
      });

      const releaseInfo: ReleaseInfo = {
        latestVersion: tag_name,
        downloadUrl: agentAsset.browser_download_url,
        outdatedNodes,
        outdatedCount: outdatedNodes.length,
      };

      if (outdatedNodes.length > 0) {
        this.emit('updateAvailable', releaseInfo);
      }

      return releaseInfo;
    } catch {
      return null;
    }
  }

  private async fetchLatestRelease(): Promise<{
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string }>;
  } | null> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'MioBridge-UpdateChecker/1.0',
    };

    if (this.options.githubToken) {
      headers['Authorization'] = `token ${this.options.githubToken}`;
    }

    const response = await fetch(GITHUB_RELEASES_URL, { headers });

    if (!response.ok) return null;

    return response.json();
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (this.options.checkIntervalMs > 0) {
      this.timer = setInterval(() => {
        this.checkForUpdates();
      }, this.options.checkIntervalMs);
    }
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
