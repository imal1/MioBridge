import { randomUUID } from 'node:crypto';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { NodeCoreComposition } from '../composition.js';

export type SubscriptionJobStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
export type SubscriptionJobStep = 'collect' | 'parse' | 'deduplicate' | 'encode' | 'convert' | 'validate' | 'publish' | 'backup' | 'done';

export interface SubscriptionJob {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly actorRole: 'admin';
  readonly status: SubscriptionJobStatus;
  readonly step: SubscriptionJobStep;
  readonly progress: number;
  readonly message: string;
  readonly sourcesTotal: number;
  readonly sourcesSucceeded: number;
  readonly nodesGenerated: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly retryOf?: string;
  readonly retryAttempt?: number;
  readonly retryRootId?: string;
  readonly backupId?: string;
}

export interface SubscriptionJobEvent {
  readonly eventId: string;
  readonly jobId: string;
  readonly status: SubscriptionJobStatus;
  readonly step: SubscriptionJobStep;
  readonly progress: number;
  readonly message: string;
  readonly timestamp: string;
}

export interface SubscriptionPolicy {
  readonly enabled: boolean;
  readonly cron: string;
  readonly freshnessHours: number;
  readonly nodeDropPercent: number;
  readonly retryDelaysMinutes: readonly number[];
  readonly backupRetention: number;
}

export interface ArtifactState {
  readonly name: 'raw.txt' | 'subscription.txt' | 'clash.yaml';
  readonly exists: boolean;
  readonly valid: boolean;
  readonly size: number;
  readonly updatedAt?: string;
  readonly ageSeconds?: number;
  readonly freshness: 'fresh' | 'expiring' | 'stale' | 'invalid';
  readonly validationError?: string;
}

const DEFAULT_POLICY: SubscriptionPolicy = {
  enabled: false,
  cron: '0 */6 * * *',
  freshnessHours: 24,
  nodeDropPercent: 30,
  retryDelaysMinutes: [1, 5, 15],
  backupRetention: 30,
};

export class SubscriptionJobService {
  readonly #jobs = new Map<string, SubscriptionJob>();
  readonly #eventCounters = new Map<string, number>();
  readonly #resumed = new Set<string>();
  readonly #timer: ReturnType<typeof setInterval>;

  constructor(private readonly composition: NodeCoreComposition, private readonly now: () => Date = () => new Date()) {
    this.#timer = setInterval(() => { void this.runSchedule(); }, 60_000);
    this.#timer.unref?.();
    void this.runSchedule();
  }

  preflight() { return this.composition.core.preflightSubscription(); }

  async start(input: { idempotencyKey?: string; retryOf?: string; retryAttempt?: number; retryRootId?: string } = {}): Promise<{ jobId: string }> {
    const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
    const existing = (await this.list()).find(job => job.idempotencyKey === idempotencyKey);
    if (existing) return { jobId: existing.id };
    const preflight = await this.preflight();
    if (!preflight.ready) throw new Error(preflight.blockingErrors.join('; '));
    const id = randomUUID();
    const policy = await this.policy();
    const lastSuccess = (await this.list()).find(job => job.status === 'succeeded' || job.status === 'partial');
    const nodeDropWarning = lastSuccess && preflight.nodesEstimated < lastSuccess.nodesGenerated * (1 - policy.nodeDropPercent / 100)
      ? [`预计节点从 ${lastSuccess.nodesGenerated} 降至 ${preflight.nodesEstimated}，超过 ${policy.nodeDropPercent}% 突降阈值`]
      : [];
    const job: SubscriptionJob = {
      id, idempotencyKey, actorRole: 'admin', status: 'queued', step: 'collect', progress: 0,
      message: '订阅生成任务已进入队列', sourcesTotal: preflight.sourcesTotal,
      sourcesSucceeded: preflight.sourcesTotal, nodesGenerated: 0,
      warnings: [...preflight.warnings, ...nodeDropWarning], errors: [], createdAt: this.now().toISOString(),
      ...(input.retryOf ? { retryOf: input.retryOf } : {}),
      ...(input.retryAttempt !== undefined ? { retryAttempt: input.retryAttempt } : {}),
      ...(input.retryRootId ? { retryRootId: input.retryRootId } : {}),
    };
    await this.save(job);
    setTimeout(() => { void this.run(id); }, 0);
    return { jobId: id };
  }

  async list(): Promise<SubscriptionJob[]> {
    await this.purgeExpiredHistory();
    const keys = await this.composition.core.state.listKeys('subscription-jobs/');
    for (const key of keys) {
      const raw = await this.composition.core.state.get(key);
      if (!raw) continue;
      try {
        const job = JSON.parse(raw) as SubscriptionJob;
        if (!job.id) continue;
        if (job.status === 'running' && !this.#jobs.has(job.id)) {
          await this.save({ ...job, status: 'failed', step: 'done', progress: 100, message: '服务重启导致任务中断，可重试', errors: [...job.errors, 'TASK_INTERRUPTED'], finishedAt: this.now().toISOString() });
        } else {
          this.#jobs.set(job.id, job);
          if (job.status === 'queued' && !this.#resumed.has(job.id)) {
            this.#resumed.add(job.id);
            setTimeout(() => { void this.run(job.id); }, 0);
          }
        }
      } catch { /* Ignore malformed history. */ }
    }
    return [...this.#jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(jobId: string): Promise<SubscriptionJob | null> {
    await this.list();
    return this.#jobs.get(jobId) ?? null;
  }

  async retry(jobId: string): Promise<{ jobId: string }> {
    const job = await this.require(jobId);
    if (job.status !== 'failed' && job.status !== 'partial') throw new Error('只有失败或部分成功任务可以重试');
    return this.start({ retryOf: job.id });
  }

  async events(jobId: string, after?: string): Promise<SubscriptionJobEvent[]> {
    await this.require(jobId);
    const keys = (await this.composition.core.state.listKeys(`subscription-events/${jobId}/`)).sort();
    const events: SubscriptionJobEvent[] = [];
    for (const key of keys) {
      const raw = await this.composition.core.state.get(key);
      if (!raw) continue;
      try {
        const event = JSON.parse(raw) as SubscriptionJobEvent;
        if (!after || event.eventId > after) events.push(event);
      } catch { /* Ignore malformed event. */ }
    }
    return events;
  }

  async policy(): Promise<SubscriptionPolicy> {
    const raw = await this.composition.core.state.get('subscription-policy.json');
    if (!raw) return DEFAULT_POLICY;
    try { return validatePolicy(JSON.parse(raw)); }
    catch { return DEFAULT_POLICY; }
  }

  async updatePolicy(value: unknown): Promise<SubscriptionPolicy> {
    const policy = validatePolicy(value);
    await this.composition.core.state.set('subscription-policy.json', JSON.stringify(policy));
    return policy;
  }

  async artifacts(): Promise<ArtifactState[]> {
    const policy = await this.policy();
    return Promise.all((['raw.txt', 'subscription.txt', 'clash.yaml'] as const).map(name => this.artifact(name, policy)));
  }

  async preview(name: string): Promise<{ name: string; content: string; truncated: boolean }> {
    const artifact = artifactName(name);
    const source = (await this.composition.core.artifacts.getFileContent(artifact)).toString('utf8');
    const maximum = 50_000;
    return { name: artifact, content: source.slice(0, maximum), truncated: source.length > maximum };
  }

  async validateArtifact(name?: string): Promise<ArtifactState[]> {
    const states = await this.artifacts();
    return name ? states.filter(state => state.name === artifactName(name)) : states;
  }

  private async run(jobId: string): Promise<void> {
    const initial = await this.require(jobId);
    if (initial.status !== 'queued') return;
    try {
      await this.patch(jobId, { status: 'running', step: 'collect', progress: 10, message: '采集本机与远端来源', startedAt: this.now().toISOString() });
      await this.patch(jobId, { status: 'running', step: 'parse', progress: 25, message: '解析代理来源' });
      await this.patch(jobId, { status: 'running', step: 'deduplicate', progress: 40, message: '去重并整理代理节点' });
      await this.patch(jobId, { status: 'running', step: 'encode', progress: 55, message: '编码订阅内容' });
      await this.patch(jobId, { status: 'running', step: 'convert', progress: 68, message: '生成 Clash 衍生产物' });
      const result = await this.composition.core.updateSubscription();
      await this.patch(jobId, { status: 'running', step: 'validate', progress: 82, message: '验证每个订阅产物' });
      const artifacts = await this.artifacts();
      await this.patch(jobId, { status: 'running', step: 'publish', progress: 92, message: '发布正式产物' });
      const failed = artifacts.filter(artifact => !artifact.valid);
      await this.patch(jobId, { status: 'running', step: 'backup', progress: 97, message: '保存订阅备份并清理保留范围' });
      await this.cleanupBackups((await this.policy()).backupRetention);
      const allWarnings = [...initial.warnings, ...(result.warnings ?? []), ...failed.map(item => `${item.name}: ${item.validationError ?? '无效'}`)];
      const status: SubscriptionJobStatus = failed.length === 0 && allWarnings.length === 0 && !(result.errors?.length) ? 'succeeded' : 'partial';
      await this.patch(jobId, {
        status, step: 'done', progress: 100,
        message: status === 'succeeded' ? '订阅生成完成' : '订阅部分生成成功',
        nodesGenerated: result.nodesCount,
        warnings: allWarnings,
        errors: result.errors ?? [], backupId: result.backupCreated, finishedAt: this.now().toISOString(),
      });
    } catch (error) {
      const failed = await this.patch(jobId, {
        status: 'failed', step: 'done', progress: 100, message: '订阅生成失败',
        errors: [error instanceof Error ? error.message : String(error)], finishedAt: this.now().toISOString(),
      });
      await this.scheduleRetry(failed);
    }
  }

  private async artifact(name: ArtifactState['name'], policy: SubscriptionPolicy): Promise<ArtifactState> {
    const path = join(this.composition.paths.dataDir, name);
    try {
      const details = await stat(path);
      const content = (await this.composition.core.artifacts.getFileContent(name)).toString('utf8');
      const error = validateContent(name, content);
      const ageSeconds = Math.max(0, Math.floor((this.now().getTime() - details.mtimeMs) / 1000));
      const threshold = policy.freshnessHours * 3600;
      return {
        name, exists: true, valid: !error, size: details.size, updatedAt: details.mtime.toISOString(), ageSeconds,
        freshness: error ? 'invalid' : ageSeconds > threshold ? 'stale' : ageSeconds >= threshold * 0.8 ? 'expiring' : 'fresh',
        ...(error ? { validationError: error } : {}),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { name, exists: false, valid: false, size: 0, freshness: 'invalid', validationError: '文件不存在' };
      throw error;
    }
  }

  private async runSchedule(): Promise<void> {
    await this.runDueRetries();
    const policy = await this.policy();
    if (!policy.enabled || !cronMatches(policy.cron, this.now())) return;
    const slot = this.now().toISOString().slice(0, 16);
    const previous = await this.composition.core.state.get('subscription-schedule/last-slot.txt');
    if (previous === slot) return;
    await this.composition.core.state.set('subscription-schedule/last-slot.txt', slot);
    await this.start({ idempotencyKey: `schedule:${slot}` }).catch(() => undefined);
  }

  private async scheduleRetry(job: SubscriptionJob): Promise<void> {
    const policy = await this.policy();
    const attempt = job.retryAttempt ?? 0;
    const delay = policy.retryDelaysMinutes[attempt];
    if (delay === undefined) return;
    const root = job.retryRootId ?? job.id;
    const record = { sourceJobId: job.id, rootJobId: root, attempt: attempt + 1, dueAt: this.now().getTime() + delay * 60_000 };
    await this.composition.core.state.set(`subscription-retries/${job.id}.json`, JSON.stringify(record));
  }

  private async runDueRetries(): Promise<void> {
    for (const key of await this.composition.core.state.listKeys('subscription-retries/')) {
      const raw = await this.composition.core.state.get(key);
      if (!raw) continue;
      try {
        const record = JSON.parse(raw) as { sourceJobId: string; rootJobId: string; attempt: number; dueAt: number };
        if (record.dueAt > this.now().getTime()) continue;
        await this.start({
          idempotencyKey: `policy-retry:${record.rootJobId}:${record.attempt}`,
          retryOf: record.sourceJobId, retryAttempt: record.attempt, retryRootId: record.rootJobId,
        });
        await this.composition.core.state.del(key);
      } catch { /* Keep malformed or temporarily blocked retry records for diagnosis. */ }
    }
  }

  private async purgeExpiredHistory(): Promise<void> {
    const cutoff = this.now().getTime() - 30 * 86400000;
    for (const key of await this.composition.core.state.listKeys('subscription-jobs/')) {
      const raw = await this.composition.core.state.get(key);
      if (!raw) continue;
      try {
        const job = JSON.parse(raw) as SubscriptionJob;
        if (!job.finishedAt || Date.parse(job.finishedAt) >= cutoff) continue;
        await this.composition.core.state.del(key);
        this.#jobs.delete(job.id);
        for (const event of await this.composition.core.state.listKeys(`subscription-events/${job.id}/`)) await this.composition.core.state.del(event);
      } catch { /* Ignore malformed history during retention cleanup. */ }
    }
  }

  private async cleanupBackups(retention: number): Promise<void> {
    try {
      const files = (await readdir(this.composition.paths.backupDir)).filter(file => /^subscription_.*\.txt$/.test(file)).sort().reverse();
      await Promise.all(files.slice(retention).map(file => rm(join(this.composition.paths.backupDir, file), { force: true })));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async patch(jobId: string, patch: Partial<SubscriptionJob>): Promise<SubscriptionJob> {
    const current = await this.require(jobId);
    const next = { ...current, ...patch };
    await this.save(next);
    return next;
  }

  private async require(jobId: string): Promise<SubscriptionJob> {
    const cached = this.#jobs.get(jobId);
    if (cached) return cached;
    const raw = await this.composition.core.state.get(`subscription-jobs/${jobId}.json`);
    if (!raw) throw new Error(`订阅任务 ${jobId} 不存在`);
    const job = JSON.parse(raw) as SubscriptionJob;
    this.#jobs.set(jobId, job);
    return job;
  }

  private async save(job: SubscriptionJob): Promise<void> {
    const terminal = job.status === 'succeeded' || job.status === 'partial' || job.status === 'failed';
    // Claim queued/running jobs in memory before exposing their snapshot so the
    // same process never mistakes an in-flight write for restart recovery.
    if (!terminal) this.#jobs.set(job.id, job);
    let counter = this.#eventCounters.get(job.id);
    if (counter === undefined) counter = (await this.composition.core.state.listKeys(`subscription-events/${job.id}/`)).length;
    counter += 1;
    this.#eventCounters.set(job.id, counter);
    const eventId = String(counter).padStart(8, '0');
    const event: SubscriptionJobEvent = {
      eventId, jobId: job.id, status: job.status, step: job.step,
      progress: job.progress, message: job.message, timestamp: this.now().toISOString(),
    };
    await this.composition.core.state.set(`subscription-events/${job.id}/${eventId}.json`, JSON.stringify(event));
    // Publish the snapshot only after its event is durable. Readers that observe a
    // terminal job can therefore always resume the complete event stream.
    await this.composition.core.state.set(`subscription-jobs/${job.id}.json`, JSON.stringify(job));
    if (terminal) this.#jobs.set(job.id, job);
  }
}

function validatePolicy(value: unknown): SubscriptionPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('订阅策略无效');
  const candidate = value as Partial<SubscriptionPolicy>;
  const policy: SubscriptionPolicy = {
    enabled: candidate.enabled === true,
    cron: candidate.cron ?? DEFAULT_POLICY.cron,
    freshnessHours: candidate.freshnessHours ?? DEFAULT_POLICY.freshnessHours,
    nodeDropPercent: candidate.nodeDropPercent ?? DEFAULT_POLICY.nodeDropPercent,
    retryDelaysMinutes: candidate.retryDelaysMinutes ?? DEFAULT_POLICY.retryDelaysMinutes,
    backupRetention: candidate.backupRetention ?? DEFAULT_POLICY.backupRetention,
  };
  if (policy.cron.trim().split(/\s+/).length !== 5) throw new Error('Cron 必须包含 5 个字段');
  if (!Number.isFinite(policy.freshnessHours) || policy.freshnessHours < 1) throw new Error('新鲜度必须大于 0');
  if (policy.nodeDropPercent < 0 || policy.nodeDropPercent > 100) throw new Error('节点突降阈值必须为 0 到 100');
  if (!Array.isArray(policy.retryDelaysMinutes) || policy.retryDelaysMinutes.some(value => !Number.isFinite(value) || value < 0)) throw new Error('重试退避配置无效');
  if (!Number.isInteger(policy.backupRetention) || policy.backupRetention < 1) throw new Error('备份保留数必须大于 0');
  return policy;
}

function artifactName(value: string): ArtifactState['name'] {
  if (value === 'raw.txt' || value === 'subscription.txt' || value === 'clash.yaml') return value;
  throw new Error(`不支持的产物: ${value}`);
}

function validateContent(name: ArtifactState['name'], content: string): string | undefined {
  if (!content.trim()) return '文件为空';
  if (name === 'raw.txt') return content.split(/\r?\n/).some(line => /^[a-z0-9+.-]+:\/\//i.test(line.trim())) ? undefined : '不包含代理 URL';
  if (name === 'subscription.txt') {
    try {
      const encoded = content.trim();
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) return 'Base64 字符或长度无效';
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const normalized = Buffer.from(decoded).toString('base64');
      return normalized.replace(/=+$/, '') === encoded.replace(/=+$/, '') && decoded.trim() ? undefined : 'Base64 内容无效';
    }
    catch { return 'Base64 无法解码'; }
  }
  return /(^|\n)proxies\s*:/m.test(content) ? undefined : 'Clash YAML 不包含 proxies';
}

function cronMatches(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return cronField(parts[0]!, date.getMinutes(), 0)
    && cronField(parts[1]!, date.getHours(), 0)
    && cronField(parts[2]!, date.getDate(), 1)
    && cronField(parts[3]!, date.getMonth() + 1, 1)
    && cronField(parts[4]!, date.getDay(), 0);
}

function cronField(source: string, value: number, minimum: number): boolean {
  if (source === '*') return true;
  const step = source.match(/^\*\/(\d+)$/)?.[1];
  if (step) return (value - minimum) % Number(step) === 0;
  return source.split(',').some(candidate => Number(candidate) === value);
}
