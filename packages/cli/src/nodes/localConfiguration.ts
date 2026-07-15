import type { NodeRepository } from '@miobridge/core';

export interface LocalNodeConfigurationResult {
  readonly enabled: boolean;
  readonly changed: boolean;
  readonly message: string;
}

export interface LocalNodeConfigurationAdapters {
  confirm(message: string): Promise<boolean>;
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
    await this.repository.configureLocalNode(enabled);
    return {
      enabled,
      changed: previous !== enabled,
      message: enabled
        ? 'Local node enabled and included in dashboard monitoring.'
        : 'Local node disabled; child nodes are unchanged.',
    };
  }
}

export function formatLocalNodeConfiguration(result: LocalNodeConfigurationResult): string {
  return `local-node: ${result.enabled ? 'enabled' : 'disabled'}${result.changed ? ' [changed]' : ''} — ${result.message}`;
}
