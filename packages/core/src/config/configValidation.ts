import { validateSchedule } from './schedule.js';
import type {
  ConfigFieldDefinition,
  ConfigValidationIssue,
  ConfigValidationResult,
  FullConfig,
} from '../types/config.js';

const VALUE = Symbol('config-value');
type ConfigShape = { readonly [key: string]: ConfigShape | typeof VALUE };

const CONFIG_SHAPE: ConfigShape = {
  app: {
    name: VALUE,
    version: VALUE,
    environment: VALUE,
    port: VALUE,
    public_base_url: VALUE,
    log_level: VALUE,
    timezone: VALUE,
  },
  network: { request_timeout: VALUE },
  protocols: { sing_box_configs: VALUE },
  binaries: {
    mihomo_path: VALUE,
    sing_box_path: VALUE,
    xray_path: VALUE,
    v2ray_path: VALUE,
  },
  directories: {
    data_dir: VALUE,
    log_dir: VALUE,
    backup_dir: VALUE,
  },
  subscription: {
    clash_filename: VALUE,
    enabled: VALUE,
    cron: VALUE,
    freshness_hours: VALUE,
    stale_source_max_hours: VALUE,
    auto_regenerate: VALUE,
    node_drop_percent: VALUE,
    retry_delays_minutes: VALUE,
    backup_retention: VALUE,
  },
  deployment: {
    concurrency: VALUE,
    ssh_timeout_ms: VALUE,
    task_timeout_ms: VALUE,
    task_retention_days: VALUE,
  },
  notifications: {
    webhook: {
      enabled: VALUE,
      url: VALUE,
      events: VALUE,
      template: VALUE,
      target: VALUE,
    },
  },
  logs: {
    level: VALUE,
    task_retention_days: VALUE,
  },
};

export const CONFIG_FIELDS: readonly ConfigFieldDefinition[] = [
  { path: 'app.port', type: 'number', minimum: 1, maximum: 65535, restartRequired: true },
  { path: 'app.public_base_url', type: 'string', restartRequired: false },
  { path: 'app.timezone', type: 'string', restartRequired: false },
  { path: 'network.request_timeout', type: 'number', minimum: 1000, maximum: 300000, restartRequired: true },
  { path: 'protocols.sing_box_configs', type: 'string[]', restartRequired: true },
  { path: 'binaries.mihomo_path', type: 'string', restartRequired: true },
  { path: 'binaries.sing_box_path', type: 'string', restartRequired: true },
  { path: 'directories.data_dir', type: 'string', restartRequired: true },
  { path: 'directories.log_dir', type: 'string', restartRequired: true },
  { path: 'directories.backup_dir', type: 'string', restartRequired: true },
  { path: 'subscription.auto_regenerate', type: 'boolean', restartRequired: false },
  { path: 'subscription.stale_source_max_hours', type: 'number', minimum: 0, maximum: 8760, restartRequired: false },
  { path: 'subscription.enabled', type: 'boolean', restartRequired: false },
  { path: 'subscription.cron', type: 'string', restartRequired: false },
  { path: 'subscription.freshness_hours', type: 'number', minimum: 1, maximum: 8760, restartRequired: false },
  { path: 'subscription.node_drop_percent', type: 'number', minimum: 0, maximum: 100, restartRequired: false },
  { path: 'subscription.retry_delays_minutes', type: 'number[]', restartRequired: false },
  { path: 'subscription.backup_retention', type: 'number', minimum: 1, maximum: 1000, restartRequired: false },
  { path: 'deployment.ssh_timeout_ms', type: 'number', minimum: 1000, maximum: 300000, restartRequired: false },
  { path: 'deployment.task_timeout_ms', type: 'number', minimum: 10000, maximum: 86400000, restartRequired: false },
  { path: 'deployment.task_retention_days', type: 'number', minimum: 1, maximum: 3650, restartRequired: false },
  { path: 'notifications.webhook.enabled', type: 'boolean', restartRequired: false },
  { path: 'notifications.webhook.url', type: 'string', restartRequired: false },
  { path: 'notifications.webhook.template', type: 'string', allowed: ['generic', 'telegram', 'bark', 'wechat'], restartRequired: false },
  { path: 'notifications.webhook.target', type: 'string', restartRequired: false },
  { path: 'notifications.webhook.events', type: 'string[]', restartRequired: false },
  { path: 'logs.level', type: 'string', allowed: ['debug', 'info', 'warn', 'error'], restartRequired: false },
  { path: 'logs.task_retention_days', type: 'number', minimum: 1, maximum: 3650, restartRequired: false },
] as const;

const STATIC_FIELDS = [
  { path: 'app.name' },
  { path: 'app.version' },
  { path: 'app.environment' },
] as const;

export function validateConfigDocument(document: FullConfig): ConfigValidationResult {
  const issues: ConfigValidationIssue[] = [];
  validateShape(document, CONFIG_SHAPE, '$', issues);

  for (const field of CONFIG_FIELDS) {
    const value = valueAt(document, field.path);
    if (value === undefined) continue;
    const error = validateField(field, value);
    if (error) issues.push({ path: field.path, message: error });
  }
  for (const field of STATIC_FIELDS) {
    const value = valueAt(document, field.path);
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
      issues.push({ path: field.path, message: '必须是非空字符串' });
    }
  }

  const configs = document.protocols?.sing_box_configs;
  if (Array.isArray(configs) && new Set(configs).size !== configs.length) {
    issues.push({ path: 'protocols.sing_box_configs', message: '配置名称不能重复' });
  }
  return { valid: issues.length === 0, issues };
}

export function validateField(field: ConfigFieldDefinition, value: unknown): string | null {
  const arrayType = field.type.endsWith('[]');
  if (arrayType) {
    if (!Array.isArray(value) || (value.length === 0 && field.path !== 'subscription.retry_delays_minutes' && field.path !== 'notifications.webhook.events')) return '必须是非空数组';
    const expected = field.type === 'string[]' ? 'string' : 'number';
    if (value.some(item => typeof item !== expected
      || (expected === 'string' && !(item as string).trim())
      || (expected === 'number' && !Number.isFinite(item)))) {
      return `数组元素必须为 ${expected}`;
    }
    return null;
  }
  if (typeof value !== field.type) return `必须是 ${field.type}`;
  if (typeof value === 'string') {
    if (!value.trim()) return '不能为空';
    if (field.path === 'subscription.cron') {
      try { validateSchedule(value); } catch (error) { return (error as Error).message; }
    }
    if (field.path === 'app.public_base_url') {
      try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '必须是 HTTP(S) 公网基地址，不包含凭据、查询或片段'; }
      catch { return '必须是有效的 HTTP(S) 地址'; }
    }
    if (field.path === 'app.timezone') {
      try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); } catch { return '无效的 IANA 时区'; }
    }
    if (field.allowed && !field.allowed.includes(value)) return `只允许: ${field.allowed.join(', ')}`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '必须是有限数字';
    if (field.minimum !== undefined && value < field.minimum) return `不能小于 ${field.minimum}`;
    if (field.maximum !== undefined && value > field.maximum) return `不能大于 ${field.maximum}`;
  }
  return null;
}

function validateShape(
  value: unknown,
  shape: ConfigShape,
  path: string,
  issues: ConfigValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({ path, message: '必须是对象' });
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === '$' ? key : `${path}.${key}`;
    const expected = shape[key];
    if (!expected) {
      issues.push({ path: childPath, message: '未知配置字段' });
      continue;
    }
    if (expected !== VALUE) validateShape(child, expected, childPath, issues);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function valueAt(document: FullConfig, path: string): unknown {
  let current: unknown = document;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
