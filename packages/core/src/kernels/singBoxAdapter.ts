import type { KernelAdapter } from './types.js';
import type { KernelLogger, ProcessRunner } from './ports.js';
import type { RuntimePaths } from '../runtime/runtimePaths.js';

export interface SingBoxAdapterOptions {
  readonly process: ProcessRunner;
  readonly logger: KernelLogger;
  readonly configs: readonly string[];
  readonly requestTimeout: number;
  readonly executable?: string;
  readonly configuredPath?: string;
  readonly paths?: RuntimePaths;
}

export class SingBoxAdapter implements KernelAdapter {
  readonly type = 'sing-box' as const;
  private executable: string | undefined;
  constructor(private readonly options: SingBoxAdapterOptions) {}
  private candidates(): string[] {
    return [...new Set([this.options.executable, this.options.configuredPath, ...(this.options.paths?.binaryCandidates('sing-box') ?? []), 'sing-box'].filter((value): value is string => Boolean(value)))];
  }
  private async resolveExecutable(): Promise<string | undefined> {
    if (this.executable) return this.executable;
    for (const candidate of this.candidates()) {
      try {
        const help = await this.options.process.run(candidate, ['help'], { timeout: 5000 });
        if (!`${help.stdout}\n${help.stderr}`.includes('url [name]')) continue;
        this.executable = candidate;
        return candidate;
      } catch { /* next candidate */ }
    }
    return undefined;
  }
  async getConfigPaths(): Promise<string[]> { return ['/etc/sing-box/config.json']; }
  async isAvailable(): Promise<boolean> {
    return Boolean(await this.resolveExecutable());
  }
  async extractNodeUrls(): Promise<string[]> {
    const urls: string[] = [];
    const executable = await this.resolveExecutable();
    if (!executable) return urls;
    for (const config of this.options.configs) {
      try {
        const result = await this.options.process.run(executable, ['url', config], { timeout: this.options.requestTimeout });
        if (result.stdout.trim()) urls.push(result.stdout.trim());
      } catch (error) {
        this.options.logger.warn(`SingBoxAdapter: 获取 ${config} URL 失败`, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    return urls;
  }
}
