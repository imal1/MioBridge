import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CoreLogger } from '../index.js';
import type { Config } from '../types/config.js';

export interface BuildMetadata { readonly version: string; readonly gitCommit?: string; readonly buildTime?: string }
export interface StatusInfo {
  subscriptionExists: boolean; clashExists: boolean; rawExists: boolean; mihomoAvailable: boolean;
  uptime: number; version: string; gitCommit?: string; buildTime?: string; mihomoVersion?: string;
  subscriptionLastUpdated?: string; subscriptionSize?: number; clashLastUpdated?: string; clashSize?: number; nodesCount?: number;
}
export interface StatusKernel { checkHealth(): Promise<boolean>; getVersion(): Promise<{ version: string } | null> }
export interface StatusServiceOptions {
  readonly config: Pick<Config, 'staticDir' | 'clashFilename'>; readonly mihomo: StatusKernel;
  readonly metadata: BuildMetadata; readonly logger: CoreLogger; readonly uptime?: () => number;
}

async function fileStats(path: string) { try { return await stat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }

export class StatusService {
  private readonly uptime: () => number;
  constructor(private readonly options: StatusServiceOptions) { this.uptime = options.uptime ?? (() => process.uptime()); }
  async getStatus(): Promise<StatusInfo> {
    const subscription = join(this.options.config.staticDir, 'subscription.txt');
    const clash = join(this.options.config.staticDir, this.options.config.clashFilename);
    const raw = join(this.options.config.staticDir, 'raw.txt');
    const [subscriptionStat, clashStat, rawStat, mihomoAvailable] = await Promise.all([fileStats(subscription), fileStats(clash), fileStats(raw), this.options.mihomo.checkHealth()]);
    const status: StatusInfo = {
      subscriptionExists: Boolean(subscriptionStat), clashExists: Boolean(clashStat), rawExists: Boolean(rawStat), mihomoAvailable,
      uptime: this.uptime(), version: this.options.metadata.version,
      ...(this.options.metadata.gitCommit ? { gitCommit: this.options.metadata.gitCommit } : {}),
      ...(this.options.metadata.buildTime ? { buildTime: this.options.metadata.buildTime } : {}),
    };
    try { status.mihomoVersion = (await this.options.mihomo.getVersion())?.version ?? 'unknown'; }
    catch (error) { this.options.logger.warn('获取 mihomo 版本失败', { error }); }
    if (subscriptionStat) { status.subscriptionLastUpdated = subscriptionStat.mtime.toISOString(); status.subscriptionSize = subscriptionStat.size; }
    if (clashStat) { status.clashLastUpdated = clashStat.mtime.toISOString(); status.clashSize = clashStat.size; }
    if (rawStat) status.nodesCount = (await readFile(raw, 'utf8')).split('\n').filter(line => line.trim()).length;
    return status;
  }
}
