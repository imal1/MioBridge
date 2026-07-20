import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CoreLogger } from '../index.js';
import type { StateStore } from '../state/stateStore.js';
import type { Config } from '../types/config.js';
import { buildClashSubscriptionResult, dedupeProxySources, type CollectedProxySource } from './sources.js';

export interface SourceCollection { readonly sources: CollectedProxySource[]; readonly errors: string[] }
export interface SubscriptionPreflight {
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
  success: boolean; message: string; timestamp: string; nodesCount: number;
  clashGenerated: boolean; backupCreated: string; durationMs?: number; warnings?: string[]; errors?: string[];
}
export interface ArtifactServiceOptions {
  readonly config: Pick<Config, 'staticDir' | 'logDir' | 'backupDir' | 'clashFilename'>;
  readonly local: LocalSourceCollector;
  readonly remote: RemoteSourceCollector;
  readonly clash: ClashConverter;
  readonly logger: CoreLogger;
  readonly state?: StateStore;
  readonly now?: () => Date;
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
    const sources = dedupeProxySources(this.extract(collected, warnings));
    const blockingErrors = sources.length === 0 ? ['零个可读代理来源'] : [];
    return {
      ready: blockingErrors.length === 0,
      sourcesTotal: collected.length,
      nodesEstimated: sources.length,
      warnings,
      blockingErrors,
    };
  }

  async updateSubscription(): Promise<UpdateResult> {
    const startedAt = Date.now();
    const collected: CollectedProxySource[] = [];
    const warnings: string[] = [];
    await this.collectLocal(collected, warnings);
    await this.collectRemote(collected, warnings);
    const sources = dedupeProxySources(this.extract(collected, warnings));
    if (sources.length === 0) throw new Error(`没有找到有效的代理URL。来源错误: ${warnings.join('; ') || '无可用节点源'}`);

    await this.ensureDirectories();
    const rawContent = sources.map(source => source.url).join('\n');
    const subscriptionContent = Buffer.from(rawContent).toString('base64');
    const subscriptionFile = join(this.options.config.staticDir, 'subscription.txt');

    const clashInput = buildClashSubscriptionResult(sources);
    warnings.push(...clashInput.errors);
    let clashGenerated = false;
    let clashError: string | undefined;
    let clashContent: string | undefined;
    try {
      if (!await this.options.clash.checkHealth()) throw new Error('Mihomo服务未运行或不可访问');
      if (!clashInput.content) throw new Error('没有可用于生成 Clash 配置的代理来源');
      clashContent = await this.options.clash.convertToClashByContent(clashInput.content);
      if (!clashContent || !clashContent.includes('proxies:')) throw new Error('转换结果不包含有效的代理配置');
      clashGenerated = true;
    } catch (error) {
      clashError = error instanceof Error ? error.message : String(error);
      this.options.logger.error('生成Clash配置失败', { error: clashError });
    }

    await this.publishArtifacts([
      { filename: 'raw.txt', content: rawContent },
      { filename: 'subscription.txt', content: subscriptionContent },
      ...(clashContent ? [{ filename: this.options.config.clashFilename, content: clashContent }] : []),
    ]);

    const timestamp = this.now().toISOString();
    const backupStamp = timestamp.replace(/[:.]/g, '-').slice(0, 19);
    const backupFile = join(this.options.config.backupDir, `subscription_${backupStamp}.txt`);
    await copyFile(subscriptionFile, backupFile);
    const result: UpdateResult = {
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
      if (!await this.options.local.isAvailable()) { errors.push('本机: Sing-box不可用，跳过本机节点源'); return; }
      target.push(...(await this.options.local.extractNodeUrls()).map(url => ({ url, kernel: 'sing-box' as const, nodeId: 'local', location: '本机' })));
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
      const value = line.trim(); const protocol = protocols.find(prefix => value.startsWith(prefix));
      if (protocol && (protocol === 'vmess://' || (value.includes('@') && value.includes(':'))) && value.length > 20) {
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
