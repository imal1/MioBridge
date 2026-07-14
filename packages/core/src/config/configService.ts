import type { RuntimePaths } from '../runtime/runtimePaths.js';
import type { Config, FullConfig } from '../types/config.js';
import type { YamlService } from './yamlService.js';

export class ConfigService {
  constructor(
    private readonly yaml: YamlService,
    private readonly paths: RuntimePaths,
    private readonly version: string,
  ) {}

  getFullConfig(): FullConfig { return this.yaml.getFullConfig(); }
  getAppVersion(): string { return this.getFullConfig().app?.version ?? this.version; }

  getConfigByPath(path: string): unknown {
    let current: unknown = this.getFullConfig();
    for (const part of path.split('.')) {
      if (typeof current !== 'object' || current === null || !(part in current)) return null;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  getConfig(): Config {
    const full = this.getFullConfig();
    return {
      singBoxConfigs: full.protocols?.sing_box_configs ?? ['vless-reality', 'hysteria2', 'trojan', 'tuic', 'vmess'],
      mihomoPath: full.binaries?.mihomo_path ?? this.paths.managedBinDir,
      clashFilename: 'clash.yaml',
      staticDir: full.directories?.data_dir ?? this.paths.dataDir,
      logDir: full.directories?.log_dir ?? this.paths.logDir,
      backupDir: full.directories?.backup_dir ?? this.paths.backupDir,
      requestTimeout: full.network?.request_timeout ?? 30_000,
    };
  }

  validateConfig(): void {
    const config = this.getConfig();
    if (config.singBoxConfigs.length === 0) throw new Error('至少需要配置一个sing-box配置名称');
  }
}
