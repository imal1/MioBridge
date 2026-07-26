import type { RuntimePaths } from '../runtime/runtimePaths.js';
import type {
  Config, ConfigApplyResult, ConfigFieldDefinition, ConfigValidationResult, FullConfig,
} from '../types/config.js';
import type { YamlService } from './yamlService.js';
import { CONFIG_FIELDS, validateConfigDocument, validateField } from './configValidation.js';

export class ConfigService {
  constructor(
    private readonly yaml: YamlService,
    private readonly paths: RuntimePaths,
    private readonly version: string,
  ) {}

  getFullConfig(): FullConfig { return this.yaml.getFullConfig(); }
  getSource(): string { return this.yaml.getConfigSource(); }
  getConfigPath(): string { return this.yaml.getConfigPath(); }
  getAppVersion(): string { return this.getFullConfig().app?.version ?? this.version; }

  getConfigByPath(path: string): unknown {
    if (!CONFIG_FIELDS.some(field => field.path === path)) throw new Error(`不支持的配置字段: ${path}`);
    let current: unknown = this.getFullConfig();
    for (const part of path.split('.')) {
      if (typeof current !== 'object' || current === null || !(part in current)) return null;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  getSchema(): readonly ConfigFieldDefinition[] { return CONFIG_FIELDS; }

  validate(source?: string): ConfigValidationResult {
    let document: FullConfig;
    try { document = source === undefined ? this.getFullConfig() : this.yaml.parseConfig(source); }
    catch (error) {
      return { valid: false, issues: [{ path: '$', message: error instanceof Error ? error.message : String(error) }] };
    }
    return validateConfigDocument(document);
  }

  setConfigByPath(path: string, value: unknown): ConfigApplyResult {
    return this.setConfigValues([{ path, value }]).results[0]!;
  }

  setConfigValues(changes: readonly { path: string; value: unknown }[]): { results: ConfigApplyResult[]; backupPath?: string; restartRequired: boolean } {
    if (changes.length === 0) throw new Error('至少需要一个配置变更');
    if (new Set(changes.map(change => change.path)).size !== changes.length) throw new Error('配置字段不能重复');
    const document = structuredClone(this.getFullConfig());
    const prepared = changes.map(change => {
      const definition = CONFIG_FIELDS.find(field => field.path === change.path);
      if (!definition) throw new Error(`不支持的配置字段: ${change.path}`);
      const error = validateField(definition, change.value);
      if (error) throw new Error(`${change.path}: ${error}`);
      setValueAt(document, change.path, change.value);
      return { ...change, definition };
    });
    const validation = this.validateDocument(document);
    if (!validation.valid) throw new Error(validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
    const replaced = this.yaml.replaceConfig(document);
    const results = prepared.map(({ path, value, definition }) => ({
      path, value, applied: true as const, restartRequired: definition.restartRequired,
      ...(replaced.backupPath ? { backupPath: replaced.backupPath } : {}),
    }));
    return { results, restartRequired: results.some(result => result.restartRequired), ...(replaced.backupPath ? { backupPath: replaced.backupPath } : {}) };
  }

  restoreLastGood(): { restored: true; backupPath: string } {
    const candidate = this.yaml.getLastGoodConfig();
    const candidateValidation = this.validateDocument(candidate);
    if (!candidateValidation.valid) throw new Error(candidateValidation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
    const restored = this.yaml.restoreLastGood();
    return restored;
  }

  replaceSource(source: string): { backupPath?: string } {
    const validation = this.validate(source);
    if (!validation.valid) throw new Error(formatValidationIssues(validation));
    return this.yaml.replaceConfigSource(source);
  }

  getConfig(): Config {
    const full = this.getFullConfig();
    return {
      singBoxConfigs: full.protocols?.sing_box_configs ?? ['vless-reality', 'hysteria2', 'trojan', 'tuic', 'vmess'],
      mihomoPath: full.binaries?.mihomo_path ?? this.paths.managedBinDir,
      clashFilename: full.subscription?.clash_filename ?? 'clash.yaml',
      staticDir: full.directories?.data_dir ?? this.paths.dataDir,
      logDir: full.directories?.log_dir ?? this.paths.logDir,
      backupDir: full.directories?.backup_dir ?? this.paths.backupDir,
      requestTimeout: full.network?.request_timeout ?? 30_000,
    };
  }

  validateConfig(): void {
    const validation = this.validate();
    if (!validation.valid) throw new Error(validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
  }

  private validateDocument(document: FullConfig): ConfigValidationResult {
    return validateConfigDocument(document);
  }
}

function valueAt(document: FullConfig, path: string): unknown {
  let current: unknown = document;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setValueAt(document: FullConfig, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = document as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}

function formatValidationIssues(validation: ConfigValidationResult): string {
  return validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ');
}
