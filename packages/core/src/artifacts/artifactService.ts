import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CoreLogger } from '../index.js';
import type { StateStore } from '../state/stateStore.js';
import type { Config } from '../types/config.js';
import { applyNodeProxy } from '../nodes/nodeProxy.js';
import type { NodeProxyConfig } from '../nodes/types.js';
import { applyNodeDisplayNames, buildClashSubscriptionResult, dedupeProxySources, type CollectedProxySource } from './sources.js';

export interface SourceCollection { readonly sources: CollectedProxySource[]; readonly errors: string[] }
export interface SubscriptionPreflight {
  readonly snapshot?: SourceCollection;
  readonly ready: boolean;
  readonly sourcesTotal: number;
  readonly nodesEstimated: number;
  readonly warnings: readonly string[];
  readonly blockingErrors: readonly string[];
}
export interface LocalSourceCollector { isAvailable(): Promise<boolean>; extractNodeUrls(): Promise<string[]> }
export interface RemoteSourceCollector { collectRemoteNodeSources(): Promise<SourceCollection> }
export interface ClashConverter {
  checkHealth(): Promise<boolean>;
  convertToClashByContent(content: string): Promise<string>;
}
export interface UpdateResult {
  diff?: { added: string[]; removed: string[] };
  success: boolean; message: string; timestamp: string; nodesCount: number;
  clashGenerated: boolean; backupCreated: string; durationMs?: number; warnings?: string[]; errors?: string[];
}
export interface ArtifactServiceOptions {
  readonly config: Pick<Config, 'staticDir' | 'logDir' | 'backupDir' | 'clashFilename'>;
  readonly local: LocalSourceCollector;
  readonly remote: RemoteSourceCollector;
  /** 本机节点档案的订阅出口设置；本机内核来源不经过 Agent，需要单独查询。 */
  readonly localNodeProxy?: () => Promise<NodeProxyConfig | undefined>;
  readonly clash: ClashConverter;
  readonly logger: CoreLogger;
  readonly state?: StateStore;
  readonly now?: () => Date;
  readonly policy?: () => { nodeDropPercent: number };
  readonly activeNodeIds?: () => Promise<string[]>;
}

const protocols = ['vless://', 'vmess://', 'ss://', 'ssr://', 'trojan://', 'hysteria2://', 'hy2://', 'tuic://', 'wireguard://'] as const;

function proxyHost(value: string): string | undefined {
  try {
    if (value.startsWith('vmess://')) {
      const decoded = JSON.parse(Buffer.from(value.slice(8), 'base64').toString('utf8')) as Record<string, unknown>;
      return typeof decoded.add === 'string' ? decoded.add : undefined;
    }
    return new URL(value).hostname;
  } catch { return undefined; }
}

function isNonRoutableProxySource(value: string): boolean {
  const host = proxyHost(value)?.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host === '0.0.0.0'
    || host === '::'
    || host === '::1'
    || /^127(?:\.|$)/.test(host)
    || /^::ffff:127(?:\.|$)/.test(host);
}

export class PublicationBlockedError extends Error {
  constructor(readonly diff: { added: string[]; removed: string[] }, readonly previous: number, readonly current: number) {
    super(`代理节点从 ${previous} 降至 ${current}，发布已阻止；请检查差异后手动确认`);
    this.name = 'PublicationBlockedError';
  }
}
export interface PublicationOptions {
  snapshot?: SourceCollection;
  force?: boolean;
  onProgress?: (step: 'collect' | 'convert' | 'validate' | 'publish' | 'backup') => Promise<void>;
}

export class ArtifactService {
  private readonly now: () => Date;
  constructor(private readonly options: ArtifactServiceOptions) { this.now = options.now ?? (() => new Date()); }

  async ensureDirectories(): Promise<void> {
    await Promise.all([this.options.config.staticDir, this.options.config.logDir, this.options.config.backupDir]
      .map(directory => mkdir(directory, { recursive: true })));
  }

  async preflight(): Promise<SubscriptionPreflight> {
    const collected: CollectedProxySource[] = [];
    const warnings: string[] = [];
    await this.collectLocal(collected, warnings);
    await this.collectRemote(collected, warnings);
    const sources = applyNodeDisplayNames(dedupeProxySources(this.extract(collected, warnings)));
    const blockingErrors = sources.length === 0 ? ['零个可读代理来源'] : [];
    return {
      snapshot: { sources, errors: warnings },
      ready: blockingErrors.length === 0,
      sourcesTotal: collected.length,
      nodesEstimated: sources.length,
      warnings,
      blockingErrors,
    };
  }

  async updateSubscription(input: PublicationOptions = {}): Promise<UpdateResult> {
    const run = () => this.generate(input);
    return this.options.state ? this.options.state.withLock('subscription-publication', run) : run();
  }

  private async generate(input: PublicationOptions): Promise<UpdateResult> {
    const startedAt = Date.now();
    this.options.logger.info('开始生成订阅');
    await input.onProgress?.('collect');
    const snapshot = input.snapshot ?? (await this.preflight()).snapshot!;
    const sources = snapshot.sources;
    const warnings = [...new Set(snapshot.errors)];
    const previousRaw = await this.options.state?.get('artifact-state/sources.json');
    let previousSources: CollectedProxySource[];
    if (previousRaw) previousSources = JSON.parse(previousRaw) as CollectedProxySource[];
    else {
      // Upgrades must protect artifacts published before source metadata existed.
      const legacy = await readFile(join(this.options.config.staticDir, 'raw.txt'), 'utf8').catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw error;
      });
      previousSources = legacy.split(/\r?\n/).filter(url => protocols.some(prefix => url.startsWith(prefix)))
        .map(url => ({ url, kernel: 'sing-box', nodeId: '__legacy__', location: '' }));
    }
    const active = await this.options.activeNodeIds?.();
    const previous = active ? previousSources.filter(source => source.nodeId === '__legacy__' || active.includes(source.nodeId)) : previousSources;
    const names = (items: CollectedProxySource[]) => buildClashSubscriptionResult(items).content.split('\n').filter(Boolean).map(url => {
      try {
        if (url.startsWith('vmess://')) return String(JSON.parse(Buffer.from(url.slice(8), 'base64').toString()).ps ?? 'vmess');
        return decodeURIComponent(url.split('#')[1] ?? '代理节点');
      } catch { return '代理节点'; }
    });
    const diff = { added: names(sources.filter(source => !previous.some(old => old.url === source.url))), removed: names(previous.filter(old => !sources.some(source => source.url === old.url))) };
    if (!input.force && sources.length < previous.length * (1 - (this.options.policy?.().nodeDropPercent ?? 30) / 100)) {
      throw new PublicationBlockedError(diff, previous.length, sources.length);
    }
    if (sources.length === 0) throw new Error(`没有找到有效的代理URL。来源错误: ${warnings.join('; ') || '无可用节点源'}`);

    await this.ensureDirectories();
    const rawContent = sources.map(source => source.url).join('\n');
    const subscriptionContent = Buffer.from(rawContent).toString('base64');
    const subscriptionFile = join(this.options.config.staticDir, 'subscription.txt');

    await input.onProgress?.('convert');
    const clashInput = buildClashSubscriptionResult(sources);
    warnings.push(...clashInput.errors);
    let clashGenerated = false;
    let clashError: string | undefined;
    let clashContent: string | undefined;
    try {
      if (!clashInput.content) throw new Error('没有可用于生成 Clash 配置的代理来源');
      // Clash 产物是纯解析 + 模板生成，并不依赖 mihomo；mihomo 只在可用时做一次校验。
      // 故 mihomo 不可用时照常生成并写盘（跳过校验），仅记一条警告——绝不因缺 mihomo 丢弃这次更新。
      if (!await this.options.clash.checkHealth()) warnings.push('mihomo 不可用：已生成 Clash 配置但跳过校验');
      clashContent = await this.options.clash.convertToClashByContent(clashInput.content);
      if (!clashContent || !clashContent.includes('proxies:')) throw new Error('转换结果不包含有效的代理配置');
      clashGenerated = true;
    } catch (error) {
      clashError = error instanceof Error ? error.message : String(error);
      this.options.logger.error('生成Clash配置失败', { error: clashError });
    }

    await input.onProgress?.('validate');
    await input.onProgress?.('publish');
    await this.publishArtifacts([
      { filename: 'raw.txt', content: rawContent },
      { filename: 'subscription.txt', content: subscriptionContent },
      ...(clashContent ? [{ filename: this.options.config.clashFilename, content: clashContent }] : []),
    ]);

    await this.options.state?.set('artifact-state/sources.json', JSON.stringify(sources));
    await input.onProgress?.('backup');
    const timestamp = this.now().toISOString();
    const backupStamp = timestamp.replace(/[:.]/g, '-').slice(0, 19);
    const backupFile = join(this.options.config.backupDir, `subscription_${backupStamp}.txt`);
    await copyFile(subscriptionFile, backupFile);
    const result: UpdateResult = {
      diff,
      success: true,
      message: `订阅更新成功，共 ${sources.length} 个节点${clashGenerated ? '' : ' (Clash生成失败)'}`,
      timestamp,
      nodesCount: sources.length,
      clashGenerated,
      backupCreated: backupFile,
      durationMs: Date.now() - startedAt,
      ...(warnings.length ? { warnings } : {}),
      ...(clashError ? { errors: [`Clash生成失败: ${clashError}`] } : {}),
    };
    if (this.options.state) {
      const status = clashGenerated ? 'success' : 'partial';
      await this.options.state.set('artifact-state/last-update.json', JSON.stringify({
        status, timestamp, durationMs: result.durationMs, nodesCount: result.nodesCount,
      })).catch(error => this.options.logger.warn('保存订阅生成状态失败', { error }));
    }
    this.options.logger.info('订阅生成完成', { nodesCount: result.nodesCount, durationMs: result.durationMs });
    for (const warning of warnings) this.options.logger.warn(warning);
    return result;
  }

  async getFileContent(filename: string): Promise<Buffer> {
    if (filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') throw new Error(`非法的产物文件名: ${filename}`);
    return readFile(join(this.options.config.staticDir, filename));
  }

  private async publishArtifacts(files: readonly { filename: string; content: string }[]): Promise<void> {
    const stamp = `${process.pid}-${Date.now()}`;
    const prepared = files.map(file => ({
      ...file, target: join(this.options.config.staticDir, file.filename),
      temporary: join(this.options.config.staticDir, `.${file.filename}.${stamp}.tmp`),
    }));
    try {
      await Promise.all(prepared.map(file => writeFile(file.temporary, file.content, { encoding: 'utf8', mode: 0o600 })));
      for (const file of prepared) {
        if ((await stat(file.temporary)).size === 0) throw new Error(`${file.filename} 临时产物为空`);
      }
      for (const file of prepared) await rename(file.temporary, file.target);
    } catch (error) {
      await Promise.all(prepared.map(file => rm(file.temporary, { force: true })));
      throw error;
    }
  }

  private async collectLocal(target: CollectedProxySource[], errors: string[]): Promise<void> {
    try {
      if (!await this.options.local.isAvailable()) return;
      const urls = await this.options.local.extractNodeUrls();
      const proxy = await this.options.localNodeProxy?.().catch(() => undefined);
      target.push(...urls.map(url => ({ url, kernel: 'sing-box' as const, nodeId: 'local', location: '本机', ...(proxy ? { proxy } : {}) })));
    } catch (error) { errors.push(`本机来源收集失败: ${error instanceof Error ? error.message : String(error)}`); }
  }

  private async collectRemote(target: CollectedProxySource[], errors: string[]): Promise<void> {
    try {
      const result = await this.options.remote.collectRemoteNodeSources();
      target.push(...result.sources); errors.push(...result.errors.map(error => `节点: ${error}`));
    } catch (error) { errors.push(`节点来源收集失败: ${error instanceof Error ? error.message : String(error)}`); }
  }

  private extract(sources: readonly CollectedProxySource[], warnings: string[]): CollectedProxySource[] {
    const result: CollectedProxySource[] = [];
    for (const source of sources) for (const line of source.url.replace(/\u001b\[[0-9;]*m/g, '').split('\n')) {
      const reported = line.trim(); const protocol = protocols.find(prefix => reported.startsWith(prefix));
      if (protocol && (protocol === 'vmess://' || (reported.includes('@') && reported.includes(':'))) && reported.length > 20) {
        // 先应用节点的显式出口设置，再判断可路由性：内核只上报回环/IP 地址时，
        // 用户配置的连接域名正是让该来源可发布的依据。
        const value = applyNodeProxy(reported, source.proxy);
        if (isNonRoutableProxySource(value)) {
          warnings.push(`节点 ${source.nodeId} 内核 ${source.kernel} 返回了不可路由的回环或监听地址，已跳过`);
          continue;
        }
        result.push({ ...source, url: value });
      }
    }
    return result;
  }
}
