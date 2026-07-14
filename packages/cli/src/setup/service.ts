import { join } from 'node:path';
import { PINNED_ARTIFACTS } from './catalog.js';
import type { DependencyName, DependencyStatus, SetupOptions } from './types.js';

const DEFINITIONS: readonly { name: DependencyName; required: boolean; capability: string }[] = [
  { name: 'mihomo', required: true, capability: 'Clash conversion and validation' },
  { name: 'sing-box', required: false, capability: 'optional local source discovery' },
];

function safeUrl(url: string): string {
  try { const parsed = new URL(url); return `${parsed.protocol}//${parsed.host}${parsed.pathname}`; } catch { return '<redacted-url>'; }
}

export class DependencySetupService {
  constructor(private readonly options: SetupOptions) {}

  async discover(name: DependencyName): Promise<DependencyStatus> {
    const definition = DEFINITIONS.find(item => item.name === name)!;
    const configured = this.options.configured?.[name];
    if (configured) {
      // Existing config files store binary directories while newer users may
      // provide an exact executable. Support both without rewriting config.
      for (const candidate of [configured, join(configured, name)]) {
        if (await this.options.adapters.existsExecutable(candidate)) return this.status(definition, 'configured', candidate);
      }
    }
    const managed = join(this.options.paths.managedBinDir, name);
    if (await this.options.adapters.existsExecutable(managed)) return this.status(definition, 'managed', managed);
    for (const directory of this.options.paths.pathDirectories) {
      const candidate = join(directory, name);
      if (await this.options.adapters.existsExecutable(candidate)) return this.status(definition, 'PATH', candidate);
    }
    return { ...definition, origin: 'missing' };
  }

  async run(options: { readonly assumeYes?: boolean } = {}): Promise<readonly DependencyStatus[]> {
    const platform = await this.options.adapters.platform();
    const results: DependencyStatus[] = [];
    for (const definition of DEFINITIONS) {
      let status = await this.discover(definition.name);
      if (status.origin !== 'missing' || definition.name === 'sing-box') { results.push(status); continue; }
      const artifact = (this.options.artifacts ?? PINNED_ARTIFACTS)[definition.name][platform.architecture];
      const accepted = options.assumeYes
        || await this.options.adapters.confirm(`Install pinned ${definition.name} ${artifact.version} to ${this.options.paths.managedBinDir}?`);
      if (!accepted) { results.push(status); continue; }
      try {
        const downloaded = await this.options.adapters.download(artifact.url);
        const digest = await this.options.adapters.sha256(downloaded);
        if (digest.toLowerCase() !== artifact.sha256.toLowerCase()) throw new Error(`Checksum mismatch for ${definition.name}`);
        const binary = await this.options.adapters.extract(downloaded, artifact);
        const target = join(this.options.paths.managedBinDir, definition.name);
        await this.options.adapters.installAtomic(target, binary, async temporaryPath => {
          const version = await this.options.adapters.probeVersion(temporaryPath, artifact.versionArgs);
          if (!version.includes(artifact.version.replace(/^v/, ''))) throw new Error(`Version validation failed for ${definition.name}: expected ${artifact.version}`);
        });
        status = { ...await this.status(definition, 'managed', target), installed: true };
      } catch (error) {
        throw new Error(`Unable to install ${definition.name} from ${safeUrl(artifact.url)}: ${error instanceof Error ? error.message : String(error)}`);
      }
      results.push(status);
    }
    return results;
  }

  private async status(definition: typeof DEFINITIONS[number], origin: DependencyStatus['origin'], path: string): Promise<DependencyStatus> {
    let version: string | undefined;
    try { version = await this.options.adapters.probeVersion(path, ['--version']); } catch { /* executable origin remains useful */ }
    return { ...definition, origin, path, ...(version ? { version } : {}) };
  }
}

export function formatSetupStatus(statuses: readonly DependencyStatus[]): string {
  return statuses.map(item => `${item.name}: ${item.origin}${item.path ? ` (${item.path})` : ''}${item.required ? '' : ' [optional]'} — ${item.capability}${item.installed ? ' [installed]' : ''}`).join('\n');
}
