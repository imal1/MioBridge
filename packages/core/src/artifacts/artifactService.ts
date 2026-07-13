import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CoreLogger } from '../index.js';
import type { Config } from '../types/config.js';
import { buildClashSubscriptionResult, dedupeProxySources, type CollectedProxySource } from './sources.js';

export interface SourceCollection { readonly sources: CollectedProxySource[]; readonly errors: string[] }
export interface LocalSourceCollector { isAvailable(): Promise<boolean>; extractNodeUrls(): Promise<string[]> }
export interface RemoteSourceCollector { collectRemoteNodeSources(): Promise<SourceCollection> }
export interface ClashConverter {
  checkHealth(): Promise<boolean>;
  convertToClashByContent(content: string): Promise<string>;
}
export interface UpdateResult {
  success: boolean; message: string; timestamp: string; nodesCount: number;
  clashGenerated: boolean; backupCreated: string; warnings?: string[]; errors?: string[];
}
export interface ArtifactServiceOptions {
  readonly config: Pick<Config, 'staticDir' | 'logDir' | 'backupDir' | 'clashFilename'>;
  readonly local: LocalSourceCollector;
  readonly remote: RemoteSourceCollector;
  readonly clash: ClashConverter;
  readonly logger: CoreLogger;
  readonly now?: () => Date;
}

const protocols = ['vless://', 'vmess://', 'ss://', 'ssr://', 'trojan://', 'hysteria2://', 'tuic://', 'wireguard://'] as const;

export class ArtifactService {
  private readonly now: () => Date;
  constructor(private readonly options: ArtifactServiceOptions) { this.now = options.now ?? (() => new Date()); }

  async ensureDirectories(): Promise<void> {
    await Promise.all([this.options.config.staticDir, this.options.config.logDir, this.options.config.backupDir]
      .map(directory => mkdir(directory, { recursive: true })));
  }

  async updateSubscription(): Promise<UpdateResult> {
    const collected: CollectedProxySource[] = [];
    const warnings: string[] = [];
    await this.collectLocal(collected, warnings);
    await this.collectRemote(collected, warnings);
    const sources = dedupeProxySources(this.extract(collected));
    if (sources.length === 0) throw new Error(`没有找到有效的代理URL。来源错误: ${warnings.join('; ') || '无可用节点源'}`);

    await this.ensureDirectories();
    const rawContent = sources.map(source => source.url).join('\n');
    const subscriptionContent = Buffer.from(rawContent).toString('base64');
    const subscriptionFile = join(this.options.config.staticDir, 'subscription.txt');
    await writeFile(subscriptionFile, subscriptionContent, 'utf8');
    await writeFile(join(this.options.config.staticDir, 'raw.txt'), rawContent, 'utf8');

    const clashInput = buildClashSubscriptionResult(sources);
    warnings.push(...clashInput.errors);
    let clashGenerated = false;
    let clashError: string | undefined;
    try {
      if (!await this.options.clash.checkHealth()) throw new Error('Mihomo服务未运行或不可访问');
      if (!clashInput.content) throw new Error('没有可用于生成 Clash 配置的代理来源');
      const clashContent = await this.options.clash.convertToClashByContent(clashInput.content);
      if (!clashContent || !clashContent.includes('proxies:')) throw new Error('转换结果不包含有效的代理配置');
      const clashFile = join(this.options.config.staticDir, this.options.config.clashFilename);
      await writeFile(clashFile, clashContent, 'utf8');
      clashGenerated = (await stat(clashFile)).size > 0;
      if (!clashGenerated) throw new Error('文件写入失败或文件为空');
    } catch (error) {
      clashError = error instanceof Error ? error.message : String(error);
      this.options.logger.error('生成Clash配置失败', { error: clashError });
    }

    const timestamp = this.now().toISOString();
    const backupStamp = timestamp.replace(/[:.]/g, '-').slice(0, 19);
    const backupFile = join(this.options.config.backupDir, `subscription_${backupStamp}.txt`);
    await copyFile(subscriptionFile, backupFile);
    return {
      success: true,
      message: `订阅更新成功，共 ${sources.length} 个节点${clashGenerated ? '' : ' (Clash生成失败)'}`,
      timestamp,
      nodesCount: sources.length,
      clashGenerated,
      backupCreated: backupFile,
      ...(warnings.length ? { warnings } : {}),
      ...(clashError ? { errors: [`Clash生成失败: ${clashError}`] } : {}),
    };
  }

  async getFileContent(filename: string): Promise<Buffer> {
    if (filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') throw new Error(`非法的产物文件名: ${filename}`);
    return readFile(join(this.options.config.staticDir, filename));
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
      target.push(...result.sources); errors.push(...result.errors.map(error => `远端: ${error}`));
    } catch (error) { errors.push(`远端来源收集失败: ${error instanceof Error ? error.message : String(error)}`); }
  }

  private extract(sources: readonly CollectedProxySource[]): CollectedProxySource[] {
    const result: CollectedProxySource[] = [];
    for (const source of sources) for (const line of source.url.replace(/\u001b\[[0-9;]*m/g, '').split('\n')) {
      const value = line.trim(); const protocol = protocols.find(prefix => value.startsWith(prefix));
      if (protocol && (protocol === 'vmess://' || (value.includes('@') && value.includes(':'))) && value.length > 20) result.push({ ...source, url: value });
    }
    return result;
  }
}
