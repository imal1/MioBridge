import type { RuntimePaths } from '../runtime/runtimePaths.js';
import type {
  Config, ConfigApplyResult, ConfigFieldDefinition, ConfigValidationIssue,
  ConfigValidationResult, FullConfig,
} from '../types/config.js';
import type { YamlService } from './yamlService.js';

export class ConfigService {
  constructor(
    private readonly yaml: YamlService,
    private readonly paths: RuntimePaths,
    private readonly version: string,
  ) {}

  getFullConfig(): FullConfig { return this.yaml.getFullConfig(); }
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
    const issues: ConfigValidationIssue[] = [];
    for (const field of CONFIG_FIELDS) {
      const value = valueAt(document, field.path);
      if (value === undefined) continue;
      const error = validateField(field, value);
      if (error) issues.push({ path: field.path, message: error });
    }
    const configs = document.protocols?.sing_box_configs;
    if (configs && new Set(configs).size !== configs.length) issues.push({ path: 'protocols.sing_box_configs', message: '配置名称不能重复' });
    return { valid: issues.length === 0, issues };
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
    const issues: ConfigValidationIssue[] = [];
    for (const field of CONFIG_FIELDS) {
      const value = valueAt(document, field.path);
      if (value === undefined) continue;
      const error = validateField(field, value);
      if (error) issues.push({ path: field.path, message: error });
    }
    const configs = document.protocols?.sing_box_configs;
    if (configs && new Set(configs).size !== configs.length) issues.push({ path: 'protocols.sing_box_configs', message: '配置名称不能重复' });
    return { valid: issues.length === 0, issues };
  }
}

const CONFIG_FIELDS: readonly ConfigFieldDefinition[] = [
  { path: 'app.port', type: 'number', minimum: 1, maximum: 65535, restartRequired: true },
  { path: 'app.public_base_url', type: 'string', restartRequired: false },
  { path: 'app.log_level', type: 'string', allowed: ['debug', 'info', 'warn', 'error'], restartRequired: false },
  { path: 'app.timezone', type: 'string', restartRequired: true },
  { path: 'network.request_timeout', type: 'number', minimum: 1000, maximum: 300000, restartRequired: false },
  { path: 'protocols.sing_box_configs', type: 'string[]', restartRequired: false },
  { path: 'binaries.mihomo_path', type: 'string', restartRequired: true },
  { path: 'binaries.sing_box_path', type: 'string', restartRequired: true },
  { path: 'binaries.xray_path', type: 'string', restartRequired: true },
  { path: 'binaries.v2ray_path', type: 'string', restartRequired: true },
  { path: 'directories.data_dir', type: 'string', restartRequired: true },
  { path: 'directories.log_dir', type: 'string', restartRequired: true },
  { path: 'directories.backup_dir', type: 'string', restartRequired: true },
  { path: 'subscription.clash_filename', type: 'string', restartRequired: false },
  { path: 'subscription.enabled', type: 'boolean', restartRequired: false },
  { path: 'subscription.cron', type: 'string', restartRequired: false },
  { path: 'subscription.freshness_hours', type: 'number', minimum: 1, maximum: 8760, restartRequired: false },
  { path: 'subscription.node_drop_percent', type: 'number', minimum: 0, maximum: 100, restartRequired: false },
  { path: 'subscription.retry_delays_minutes', type: 'number[]', restartRequired: false },
  { path: 'subscription.backup_retention', type: 'number', minimum: 1, maximum: 1000, restartRequired: false },
  { path: 'deployment.concurrency', type: 'number', minimum: 1, maximum: 32, restartRequired: false },
  { path: 'deployment.ssh_timeout_ms', type: 'number', minimum: 1000, maximum: 300000, restartRequired: false },
  { path: 'deployment.task_timeout_ms', type: 'number', minimum: 10000, maximum: 86400000, restartRequired: false },
  { path: 'deployment.task_retention_days', type: 'number', minimum: 1, maximum: 3650, restartRequired: false },
  { path: 'notifications.webhook.enabled', type: 'boolean', restartRequired: false },
  { path: 'notifications.webhook.url', type: 'string', restartRequired: false },
  { path: 'notifications.webhook.events', type: 'string[]', restartRequired: false },
  { path: 'logs.level', type: 'string', allowed: ['debug', 'info', 'warn', 'error'], restartRequired: false },
  { path: 'logs.task_retention_days', type: 'number', minimum: 1, maximum: 3650, restartRequired: false },
] as const;

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

function validateField(field: ConfigFieldDefinition, value: unknown): string | null {
  const arrayType = field.type.endsWith('[]');
  if (arrayType) {
    if (!Array.isArray(value) || value.length === 0) return '必须是非空数组';
    const expected = field.type === 'string[]' ? 'string' : 'number';
    if (value.some(item => typeof item !== expected || (expected === 'string' && !(item as string).trim()))) return `数组元素必须为 ${expected}`;
    return null;
  }
  if (typeof value !== field.type) return `必须是 ${field.type}`;
  if (typeof value === 'string') {
    if (!value.trim()) return '不能为空';
    if (field.allowed && !field.allowed.includes(value)) return `只允许: ${field.allowed.join(', ')}`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '必须是有限数字';
    if (field.minimum !== undefined && value < field.minimum) return `不能小于 ${field.minimum}`;
    if (field.maximum !== undefined && value > field.maximum) return `不能大于 ${field.maximum}`;
  }
  return null;
}
