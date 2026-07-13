import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CoreLogger } from '../index.js';
import type { RuntimePaths } from '../runtime/runtimePaths.js';
import type { FullConfig } from '../types/config.js';

const silentLogger: CoreLogger = {
  debug() {}, info() {}, warn() {}, error() {},
};

export interface YamlServiceOptions {
  readonly paths: RuntimePaths;
  readonly logger?: CoreLogger;
  readonly command?: typeof execFileSync;
}

export class YamlService {
  private readonly logger: CoreLogger;
  private readonly command: typeof execFileSync;

  constructor(private readonly options: YamlServiceOptions) {
    this.logger = options.logger ?? silentLogger;
    this.command = options.command ?? execFileSync;
  }

  getBaseDir(): string { return this.options.paths.baseDir; }
  configExists(): boolean { return existsSync(this.options.paths.configFile); }

  validateConfig(): boolean {
    if (!this.configExists() || !existsSync(this.yqPath())) return false;
    try {
      this.runYq(['eval', '.', this.options.paths.configFile]);
      this.logger.info('YAML configuration validated');
      return true;
    } catch (error) {
      this.logger.error('YAML configuration validation failed', { error });
      return false;
    }
  }

  generateConfig(templatePath: string, outputPath = this.options.paths.configFile): boolean {
    try {
      if (!existsSync(templatePath)) throw new Error(`Template does not exist: ${templatePath}`);
      if (!existsSync(this.yqPath())) throw new Error(`yq does not exist: ${this.yqPath()}`);
      mkdirSync(dirname(outputPath), { recursive: true });
      copyFileSync(templatePath, outputPath);
      const paths = this.options.paths;
      const assignments = [
        ['.directories.base_dir', paths.baseDir], ['.directories.data_dir', paths.dataDir],
        ['.directories.log_dir', paths.logDir], ['.directories.dist_dir', paths.distDir],
        ['.binaries.mihomo_path', paths.managedBinDir], ['.binaries.bun_path', paths.managedBinDir],
      ];
      for (const [field, value] of assignments) {
        this.runYq(['eval', `${field} = ${JSON.stringify(value)}`, '-i', outputPath]);
      }
      return true;
    } catch (error) {
      this.logger.error('Failed to generate YAML configuration', { error });
      return false;
    }
  }

  getFullConfig(): FullConfig {
    if (!this.configExists() || !existsSync(this.yqPath())) return {};
    try {
      return JSON.parse(this.runYq(['eval', '.', this.options.paths.configFile, '--output-format=json'])) as FullConfig;
    } catch (error) {
      this.logger.error('Failed to read YAML configuration', { error });
      return {};
    }
  }

  private yqPath(): string {
    const candidates = this.options.paths.binaryCandidates('yq');
    return candidates.find(candidate => existsSync(candidate)) ?? candidates[0]!;
  }
  private runYq(args: string[]): string {
    return this.command(this.yqPath(), args, { encoding: 'utf8', stdio: 'pipe' });
  }
}
