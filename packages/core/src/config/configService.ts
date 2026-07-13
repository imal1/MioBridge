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
  getAppEnvironment(): string { return this.getFullConfig().app?.environment ?? 'production'; }
  getAppVersion(): string { return this.getFullConfig().app?.version ?? this.version; }
  getLogLevel(): string { return this.getFullConfig().logging?.level ?? 'info'; }
  getCorsOrigin(): string { return this.getFullConfig().cors?.origin ?? '*'; }

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
      port: full.app?.port ?? 3000,
      singBoxConfigs: full.protocols?.sing_box_configs ?? ['vless-reality', 'hysteria2', 'trojan', 'tuic', 'vmess'],
      mihomoPath: full.binaries?.mihomo_path ?? this.paths.managedBinDir,
      clashFilename: 'clash.yaml',
      staticDir: full.directories?.data_dir ?? this.paths.dataDir,
      logDir: full.directories?.log_dir ?? this.paths.logDir,
      backupDir: full.directories?.backup_dir ?? this.paths.backupDir,
      autoUpdateCron: full.automation?.auto_update_cron ?? '0 */2 * * *',
      nginxPort: full.network?.nginx_port ?? 3080,
      maxRetries: full.network?.max_retries ?? 3,
      requestTimeout: full.network?.request_timeout ?? 30_000,
    };
  }

  validateConfig(): void {
    const config = this.getConfig();
    if (!config.port) throw new Error('配置字段 port 是必需的');
    if (config.singBoxConfigs.length === 0) throw new Error('至少需要配置一个sing-box配置名称');
  }
}
