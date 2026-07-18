import type {
  DashboardConfigPort,
  DashboardConvertPort,
  DashboardCorePort,
  DashboardSubscriptionPort,
  DashboardYamlPort,
  OperationsResult,
} from '@miobridge/cli';
import { parse as parseYaml } from 'yaml';
import type { HarnessState, FixtureSubscriptionJob } from './state.js';

const now = () => new Date().toISOString();

function ok<T>(data: T): OperationsResult<T> {
  return { success: true, data, timestamp: now() };
}

function fail(error: string, statusCode = 400): OperationsResult {
  return { success: false, error, statusCode, timestamp: now() };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function valueAt(source: Record<string, unknown>, path: string): unknown {
  let value: unknown = source;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function setAt(source: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let target = source;
  for (const part of parts.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) target[part] = {};
    target = target[part] as Record<string, unknown>;
  }
  target[parts.at(-1)!] = clone(value);
}

function artifactStates(state: HarnessState) {
  return state.artifacts.map(artifact => ({
    name: artifact.name,
    exists: artifact.exists,
    valid: artifact.valid,
    size: Buffer.byteLength(artifact.content),
    updatedAt: artifact.updatedAt,
    ageSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(artifact.updatedAt)) / 1000)),
    freshness: artifact.freshness,
    ...(artifact.validationError ? { validationError: artifact.validationError } : {}),
  }));
}

class HarnessStateStore {
  readonly kind = 'file' as const;

  constructor(private readonly state: HarnessState) {}

  async get(key: string): Promise<string | null> {
    if (key.startsWith('deployment-tasks/')) {
      const task = this.state.tasks.get(key.slice('deployment-tasks/'.length).replace(/\.json$/, ''));
      if (task) return JSON.stringify(task);
    }
    if (key.startsWith('deployment-events/')) {
      const match = key.match(/^deployment-events\/([^/]+)\/([^/]+)\.json$/);
      const event = match ? this.state.events.get(match[1]!)?.find(item => item.eventId === match[2]) : undefined;
      if (event) return JSON.stringify(event);
    }
    if (key.startsWith('subscription-jobs/')) {
      const job = this.state.subscriptionJobs.get(key.slice('subscription-jobs/'.length).replace(/\.json$/, ''));
      if (job) return JSON.stringify(job);
    }
    return this.state.kv.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.state.kv.set(key, value);
    if (key.startsWith('notifications/')) {
      try {
        const record = JSON.parse(value) as Record<string, unknown>;
        this.state.notificationHistory = [record, ...this.state.notificationHistory.filter(item => item.id !== record.id)];
      } catch { /* malformed fixture state remains isolated */ }
    }
  }

  async del(key: string): Promise<void> { this.state.kv.delete(key); }

  async listKeys(prefix: string): Promise<string[]> {
    const dynamic = prefix === 'deployment-tasks/'
      ? [...this.state.tasks.keys()].map(id => `deployment-tasks/${id}.json`)
      : prefix.startsWith('deployment-events/')
        ? [...(this.state.events.get(prefix.split('/')[1] ?? '') ?? [])].map(event => `${prefix}${event.eventId}.json`)
        : prefix === 'subscription-jobs/'
          ? [...this.state.subscriptionJobs.keys()].map(id => `subscription-jobs/${id}.json`)
          : [];
    return [...new Set([...dynamic, ...this.state.kv.keys()].filter(key => key.startsWith(prefix)))];
  }

  async withLock<T>(_key: string, fn: () => Promise<T>): Promise<T> { return fn(); }
}

const schema = [
  { path: 'app.port', type: 'number', minimum: 1, maximum: 65535, restartRequired: true },
  { path: 'app.log_level', type: 'string', allowed: ['debug', 'info', 'warn', 'error'], restartRequired: false },
  { path: 'network.request_timeout', type: 'number', minimum: 1000, maximum: 120000, restartRequired: false },
  { path: 'protocols.sing_box_configs', type: 'string[]', restartRequired: false },
  { path: 'subscription.enabled', type: 'boolean', restartRequired: false },
  { path: 'subscription.retry_delays_minutes', type: 'number[]', restartRequired: false },
  { path: 'notifications.webhook.enabled', type: 'boolean', restartRequired: false },
  { path: 'notifications.webhook.url', type: 'string', restartRequired: false },
] as const;

function validateConfig(state: HarnessState, source?: string) {
  if (state.controls.configValidationFailure) return { valid: false, issues: [{ path: 'app.port', message: 'fixture validation failure' }] };
  if (source) {
    try {
      const parsed = parseYaml(source);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { valid: false, issues: [{ path: '', message: '配置必须是对象' }] };
      const port = valueAt(parsed as Record<string, unknown>, 'app.port');
      if (port !== undefined && (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535)) {
        return { valid: false, issues: [{ path: 'app.port', message: '端口必须位于 1..65535' }] };
      }
    } catch (error) {
      return { valid: false, issues: [{ path: '', message: error instanceof Error ? error.message : 'YAML 无效' }] };
    }
  }
  return { valid: true, issues: [] };
}

function status(state: HarnessState) {
  const raw = state.artifacts.find(item => item.name === 'raw.txt')!;
  const subscription = state.artifacts.find(item => item.name === 'subscription.txt')!;
  const clash = state.artifacts.find(item => item.name === 'clash.yaml')!;
  return {
    subscriptionExists: subscription.exists,
    clashExists: clash.exists,
    rawExists: raw.exists,
    mihomoAvailable: true,
    subscriptionLastUpdated: subscription.updatedAt,
    subscriptionSize: Buffer.byteLength(subscription.content),
    clashLastUpdated: clash.updatedAt,
    clashSize: Buffer.byteLength(clash.content),
    nodesCount: state.nodes.reduce((total, node) => total + (node.nodesCount ?? 0), 0),
    uptime: 3600,
    version: '1.0.0-e2e',
    mihomoVersion: 'v1.19.0-e2e',
    gitCommit: 'fixture',
    buildTime: '2026-07-16T00:00:00.000Z',
  };
}

export function createCorePort(state: HarnessState): DashboardCorePort {
  const store = new HarnessStateStore(state);
  const configFacade = {
    getSchema: () => clone(schema),
    getConfig: () => ({ singBoxConfigs: clone(valueAt(state.config, 'protocols.sing_box_configs') ?? []) }),
    getFullConfig: () => clone(state.config),
    getAppVersion: () => '1.0.0-e2e',
  };
  const artifacts = {
    async getFileContent(filename: string) {
      const artifact = state.artifacts.find(item => item.name === filename);
      if (!artifact?.exists) throw new Error(`${filename} 不存在`);
      return artifact.content;
    },
  };

  return {
    config: configFacade,
    artifacts,
    state: store,
    getConfigPath: () => '/e2e/config/config.yaml',
    getEffectiveConfig: () => clone(state.config),
    getConfigValue: (path: string) => clone(valueAt(state.config, path)),
    async setConfigValue(path: string, value: unknown) {
      if (state.controls.configSaveFailure) throw new Error('fixture config save failure');
      setAt(state.config, path, value);
      const restartRequired = schema.some(field => field.path === path && field.restartRequired);
      return { path, value, applied: true, restartRequired, backupPath: '/e2e/config/last-good.yaml' };
    },
    async setConfigValues(changes: Array<{ path: string; value: unknown }>) {
      if (state.controls.configSaveFailure) throw new Error('fixture config save failure');
      const results = changes.map(change => {
        setAt(state.config, change.path, change.value);
        return { ...change, applied: true, restartRequired: schema.some(field => field.path === change.path && field.restartRequired) };
      });
      return { results, restartRequired: results.some(result => result.restartRequired), backupPath: '/e2e/config/last-good.yaml' };
    },
    async restoreLastGoodConfig() {
      if (state.controls.configRestoreFailure) throw new Error('fixture last-good restore failure');
      state.config = clone(state.lastGoodConfig);
      return { restored: true as const, backupPath: '/e2e/config/pre-restore.yaml' };
    },
    validateConfig: (source?: string) => validateConfig(state, source),
    async getStatus() { return status(state); },
    async updateSubscription() {
      return { success: true, message: 'fixture subscription updated', timestamp: now(), nodesCount: 4, clashGenerated: true, backupCreated: 'fixture-backup' };
    },
    async preflightSubscription() {
      const ready = state.controls.subscriptionReady !== false;
      return { ready, sourcesTotal: ready ? 3 : 0, nodesEstimated: ready ? 4 : 0, warnings: [], blockingErrors: ready ? [] : ['没有可读来源'] };
    },
    async getLocalLogs() {
      if (state.controls.logFailure) throw new Error('fixture log failure');
      const timestamp = now();
      return {
        entries: [
          { file: 'miobridge.log', content: JSON.stringify({ timestamp, level: 'info', component: 'control', message: 'fixture control ready' }) },
          { file: 'miobridge.log', content: JSON.stringify({ timestamp, level: 'error', component: 'subscription', message: 'fixture diagnostic marker' }) },
        ],
        files: ['miobridge.log'], updatedAt: timestamp,
      };
    },
    async getMetricsSnapshot() {
      return {
        timestamp: now(), version: '1.0.0-e2e', uptime: 3600,
        enabledNodes: state.nodes.filter(node => node.enabled).length,
        onlineNodes: state.nodes.filter(node => node.online).length,
        sources: 3, proxies: 4, mihomoAvailable: true,
        artifacts: {
          raw: { exists: state.artifacts[0]?.exists ?? false, ageSeconds: 60, size: Buffer.byteLength(state.artifacts[0]?.content ?? '') },
          subscription: { exists: state.artifacts[1]?.exists ?? false, ageSeconds: 60, size: Buffer.byteLength(state.artifacts[1]?.content ?? '') },
          clash: { exists: state.artifacts[2]?.exists ?? false, ageSeconds: 60, size: Buffer.byteLength(state.artifacts[2]?.content ?? '') },
        },
        lastGeneration: { status: 'success' as const, timestamp: now(), durationMs: 250 },
      };
    },
  } as unknown as DashboardCorePort;
}

function appendSubscriptionEvent(state: HarnessState, job: FixtureSubscriptionJob): void {
  const events = state.subscriptionEvents.get(job.id) ?? [];
  events.push({
    eventId: String(events.length + 1).padStart(8, '0'), jobId: job.id, status: job.status,
    step: job.step, progress: job.progress, message: job.message, timestamp: now(),
  });
  state.subscriptionEvents.set(job.id, events);
}

function scheduleSubscriptionStep(state: HarnessState, handler: () => void, delay = 20): void {
  const timer = setTimeout(() => {
    state.timers.delete(timer);
    handler();
  }, delay);
  state.timers.add(timer);
}

function scheduleSubscriptionCompletion(state: HarnessState, job: FixtureSubscriptionJob): void {
  const steps: Array<Pick<FixtureSubscriptionJob, 'step' | 'progress' | 'message'>> = [
    { step: 'collect', progress: 10, message: '采集本机与远端来源' },
    { step: 'parse', progress: 25, message: '解析代理来源' },
    { step: 'deduplicate', progress: 40, message: '去重并整理代理节点' },
    { step: 'encode', progress: 55, message: '编码订阅内容' },
    { step: 'convert', progress: 68, message: '生成 Clash 衍生产物' },
    { step: 'validate', progress: 82, message: '验证每个订阅产物' },
    { step: 'publish', progress: 92, message: '发布正式产物' },
    { step: 'backup', progress: 97, message: '保存订阅备份并清理保留范围' },
  ];
  const advance = (index: number): void => {
    const current = state.subscriptionJobs.get(job.id);
    if (!current || ['succeeded', 'partial', 'failed'].includes(current.status)) return;
    const next = steps[index];
    if (next) {
      Object.assign(current, next, { status: 'running', ...(index === 0 ? { startedAt: now() } : {}) });
      appendSubscriptionEvent(state, current);
      scheduleSubscriptionStep(state, () => advance(index + 1));
      return;
    }
    const failed = state.controls.subscriptionFailure === true;
    const invalidArtifacts = state.artifacts.filter(artifact => !artifact.exists || !artifact.valid);
    const status: FixtureSubscriptionJob['status'] = failed ? 'failed' : invalidArtifacts.length ? 'partial' : 'succeeded';
    Object.assign(current, {
      status, step: 'done', progress: 100,
      message: failed ? 'fixture subscription failure' : status === 'partial' ? '订阅部分生成成功' : '订阅生成完成',
      sourcesSucceeded: failed ? 0 : current.sourcesTotal, nodesGenerated: failed ? 0 : 4,
      warnings: invalidArtifacts.map(artifact => `${artifact.name}: ${artifact.validationError ?? '无效'}`),
      errors: failed ? ['FIXTURE_FAILURE'] : [], finishedAt: now(),
      ...(!failed ? { backupId: `backup-${current.id}` } : {}),
    });
    appendSubscriptionEvent(state, current);
  };
  scheduleSubscriptionStep(state, () => advance(0));
}

export function createSubscriptionPort(state: HarnessState): DashboardSubscriptionPort {
  return {
    async preflight() {
      if (state.controls.subscriptionPreflightFailure) return fail('fixture subscription preflight failure', 503);
      const ready = state.controls.subscriptionReady !== false;
      return ok({ ready, sourcesTotal: ready ? 3 : 0, nodesEstimated: ready ? 4 : 0, warnings: [], blockingErrors: ready ? [] : ['没有可读来源'] });
    },
    async start(idempotencyKey) {
      const key = idempotencyKey?.trim() || `subscription-key-${++state.sequence}`;
      const existing = state.subscriptionIdempotency.get(key);
      if (existing) return ok({ jobId: existing });
      if (state.controls.subscriptionStartFailure) return fail('fixture subscription start failure', 503);
      if (state.controls.subscriptionReady === false) return fail('没有可读来源', 409);
      const id = `subscription-${++state.sequence}`;
      const job: FixtureSubscriptionJob = {
        id, idempotencyKey: key, actorRole: 'admin', status: 'queued', step: 'collect', progress: 0,
        message: '订阅生成任务已进入队列', sourcesTotal: 3, sourcesSucceeded: 3, nodesGenerated: 0,
        warnings: [], errors: [], createdAt: now(),
      };
      state.subscriptionJobs.set(id, job);
      state.subscriptionIdempotency.set(key, id);
      appendSubscriptionEvent(state, job);
      scheduleSubscriptionCompletion(state, job);
      return ok({ jobId: id });
    },
    async list() { return ok({ jobs: [...state.subscriptionJobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }); },
    async get(jobId) { return ok(state.subscriptionJobs.get(jobId) ?? null); },
    async retry(jobId) {
      const original = state.subscriptionJobs.get(jobId);
      if (!original || !['failed', 'partial'].includes(original.status)) return fail('只有失败或部分成功任务可以重试', 409);
      if (state.controls.subscriptionRetryFailure) return fail('fixture subscription retry failure', 503);
      const id = `subscription-${++state.sequence}`;
      const job: FixtureSubscriptionJob = {
        ...clone(original), id, idempotencyKey: `retry-${id}`, retryOf: jobId,
        status: 'queued', step: 'collect', progress: 0, message: '重试任务已进入队列', createdAt: now(),
        warnings: [], errors: [], nodesGenerated: 0,
      };
      delete job.finishedAt;
      delete job.backupId;
      state.subscriptionJobs.set(id, job);
      appendSubscriptionEvent(state, job);
      scheduleSubscriptionCompletion(state, job);
      return ok({ jobId: id });
    },
    async events(jobId, afterEventId) {
      const events = state.subscriptionEvents.get(jobId) ?? [];
      return ok({ events: afterEventId ? events.filter(event => String(event.eventId) > afterEventId) : events });
    },
    async artifacts() { return ok({ artifacts: artifactStates(state) }); },
    async previewArtifact(name) {
      const artifact = state.artifacts.find(item => item.name === name);
      if (!artifact?.exists) return fail(`${name} 不存在`, 404);
      return ok({ name, content: artifact.content.slice(0, 50_000), truncated: artifact.content.length > 50_000 });
    },
    async validateArtifacts(name) {
      const artifacts = artifactStates(state).filter(artifact => !name || artifact.name === name);
      return ok({ artifacts });
    },
    async policy() { return ok(clone(state.policy)); },
    async updatePolicy(body) {
      if (state.controls.policyInvalid) return fail('订阅策略无效', 422);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('订阅策略无效', 422);
      const candidate = body as Record<string, unknown>;
      if (typeof candidate.cron !== 'string' || candidate.cron.trim().split(/\s+/).length !== 5) return fail('Cron 必须包含五段', 422);
      if (!Number.isFinite(candidate.freshnessHours) || Number(candidate.freshnessHours) < 1) return fail('新鲜度必须大于 0', 422);
      if (!Number.isFinite(candidate.nodeDropPercent) || Number(candidate.nodeDropPercent) < 0 || Number(candidate.nodeDropPercent) > 100) return fail('节点突降阈值无效', 422);
      state.policy = clone(candidate);
      return ok(clone(state.policy));
    },
  };
}

export function createConfigPort(state: HarnessState): DashboardConfigPort {
  return {
    getConfigs: () => ok({ configs: clone(valueAt(state.config, 'protocols.sing_box_configs') ?? []) }),
    async updateConfigs(configs) { setAt(state.config, 'protocols.sing_box_configs', configs); return ok({ configs, count: configs.length }); },
    async getRemoteLogs(nodeId) {
      if (state.controls.logFailure) return fail('fixture remote log failure', 502);
      const node = state.nodes.find(item => item.id === nodeId);
      if (!node) return fail('节点不存在', 404);
      return ok({
        source: 'agent', file: 'agent.log', files: ['agent.log'], nodeId, nodeName: node.name,
        lines: [JSON.stringify({ timestamp: now(), level: 'info', component: 'agent', message: 'fixture agent ready' })], updatedAt: now(),
      });
    },
  };
}

export function createYamlPort(state: HarnessState): DashboardYamlPort {
  return {
    getFullConfig: () => ok(clone(state.config)),
    getFrontendConfig: () => ok({
      ...clone(state.config), app: { name: 'miobridge', version: '1.0.0-e2e', environment: 'e2e', ...(clone(state.config.app) as Record<string, unknown>) },
      protocols: { sing_box_configs: clone(valueAt(state.config, 'protocols.sing_box_configs') ?? []) },
    }),
    async generateConfig(templatePath, outputPath) { return ok({ templatePath, outputPath: outputPath ?? '/e2e/generated.yaml', generated: true }); },
    validateConfig: () => ok(validateConfig(state)),
  };
}

export function createConvertPort(state: HarnessState): DashboardConvertPort {
  return {
    async convertContent(content) {
      if (state.controls.conversionFailure) throw new Error('fixture converter failure');
      const clashConfig = `proxies:\n  - name: e2e-converted\n    type: vless\n    server: example.invalid\n    port: 443\n# ${content.length} bytes\n`;
      return ok({ clashConfig, originalLength: content.length, configLength: clashConfig.length });
    },
    async diagnoseMihomo() { return ok({ available: true, version: { version: 'v1.19.0-e2e' } }); },
    async testProtocols() { return ok({ protocols: ['vless', 'vmess', 'trojan', 'hysteria2', 'tuic', 'shadowsocks'] }); },
  };
}
