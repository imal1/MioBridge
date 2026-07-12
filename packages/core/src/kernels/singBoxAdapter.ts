import type { KernelAdapter } from './types.js';
import type { KernelLogger, ProcessRunner } from './ports.js';

export interface SingBoxAdapterOptions {
  readonly process: ProcessRunner;
  readonly logger: KernelLogger;
  readonly configs: readonly string[];
  readonly requestTimeout: number;
  readonly executable?: string;
}

export class SingBoxAdapter implements KernelAdapter {
  readonly type = 'sing-box' as const;
  private readonly executable: string;
  constructor(private readonly options: SingBoxAdapterOptions) { this.executable = options.executable ?? 'sing-box'; }
  async getConfigPaths(): Promise<string[]> { return ['/usr/local/etc/sing-box/config.json']; }
  async isAvailable(): Promise<boolean> {
    try { await this.options.process.run(this.executable, ['version'], { timeout: 5000 }); return true; } catch { return false; }
  }
  async extractNodeUrls(): Promise<string[]> {
    const urls: string[] = [];
    for (const config of this.options.configs) {
      try {
        const result = await this.options.process.run(this.executable, ['url', config], { timeout: this.options.requestTimeout });
        if (result.stdout.trim()) urls.push(result.stdout.trim());
      } catch (error) {
        this.options.logger.warn(`SingBoxAdapter: 获取 ${config} URL 失败`, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    return urls;
  }
}
