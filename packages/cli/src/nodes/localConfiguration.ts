import { stringify } from 'yaml';
import { LOCAL_NODE_ID, type NodeRepository } from '@miobridge/core';

const DEFAULT_CONFIG_PATHS = {
  'sing-box': '/etc/sing-box/config.json',
  xray: '/etc/xray/config.json',
  v2ray: '/etc/v2ray/config.json',
} as const;

export interface LocalNodeConfigurationResult {
  readonly enabled: boolean;
  readonly changed: boolean;
  readonly message: string;
}

export interface LocalNodeConfigurationAdapters {
  confirm(message: string): Promise<boolean>;
  readonly mihomoPath?: string;
  uninstallAgent?: () => Promise<void>;
}

export class LocalNodeConfigurationService {
  constructor(
    private readonly repository: NodeRepository,
    private readonly adapters: LocalNodeConfigurationAdapters,
  ) {}

  async configure(options: { readonly enabled?: boolean; readonly assumeYes?: boolean } = {}): Promise<LocalNodeConfigurationResult> {
    const previous = await this.repository.isLocalNodeConfigured();
    const enabled = options.enabled ?? (options.assumeYes
      ? true
      : await this.adapters.confirm(`Configure this server as a local node? (currently ${previous ? 'enabled' : 'disabled'})`));
    if (!enabled && previous && this.adapters.uninstallAgent && await this.adapters.confirm('同时卸载本机 Agent？配置将保留。')) await this.adapters.uninstallAgent();
    await this.repository.configureLocalNode(enabled);
    return {
      enabled,
      changed: previous !== enabled,
      message: enabled
        ? 'Local node enabled; Agent installation is required for all-kernel monitoring.'
        : 'Local node disabled; child nodes are unchanged.',
    };
  }

  async agentConfig(): Promise<string> {
    let node = (await this.repository.list({ enabledOnly: false })).find(item => item.id === LOCAL_NODE_ID);
    if (!node) throw new Error('Local node is not configured');
    if (node.kernels.length === 0) node = await this.repository.configureLocalNode(true) ?? node;
    return stringify({
      node: { id: node.id, name: node.name, secret: node.secret },
      kernels: node.kernels.map(kernel => ({
        type: kernel.type,
        configPath: kernel.configPath ?? DEFAULT_CONFIG_PATHS[kernel.type],
      })),
      port: node.port ?? node.agent?.port ?? 3001,
    }, { lineWidth: 0 });
  }
}

export function formatLocalNodeConfiguration(result: LocalNodeConfigurationResult): string {
  return `local-node: ${result.enabled ? 'enabled' : 'disabled'}${result.changed ? ' [changed]' : ''} — ${result.message}`;
}
