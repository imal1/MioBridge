import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse, stringify } from 'yaml';
import type { CoreLogger } from '../index.js';
import type { RuntimePaths } from '../runtime/runtimePaths.js';
import type { FullConfig } from '../types/config.js';

const silentLogger: CoreLogger = {
  debug() {}, info() {}, warn() {}, error() {},
};

export interface YamlServiceOptions {
  readonly paths: RuntimePaths;
  readonly logger?: CoreLogger;
}

export class YamlService {
  private readonly logger: CoreLogger;

  constructor(private readonly options: YamlServiceOptions) {
    this.logger = options.logger ?? silentLogger;
  }

  getBaseDir(): string { return this.options.paths.baseDir; }
  configExists(): boolean { return existsSync(this.options.paths.configFile); }

  validateConfig(): boolean {
    if (!this.configExists()) return false;
    try {
      const value = parse(readFileSync(this.options.paths.configFile, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config root must be an object');
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
      mkdirSync(dirname(outputPath), { recursive: true });
      copyFileSync(templatePath, outputPath);
      const document = this.readDocument(outputPath);
      document.directories = {
        ...(document.directories as Record<string, unknown> | undefined),
        data_dir: this.options.paths.dataDir,
        log_dir: this.options.paths.logDir,
        backup_dir: this.options.paths.backupDir,
      };
      document.binaries = {
        ...(document.binaries as Record<string, unknown> | undefined),
        mihomo_path: this.options.paths.managedBinDir,
      };
      writeFileSync(outputPath, stringify(document, { lineWidth: 0 }), 'utf8');
      return true;
    } catch (error) {
      this.logger.error('Failed to generate YAML configuration', { error });
      return false;
    }
  }

  getFullConfig(): FullConfig {
    if (!this.configExists()) return {};
    try {
      return this.readDocument(this.options.paths.configFile) as FullConfig;
    } catch (error) {
      this.logger.error('Failed to read YAML configuration', { error });
      return {};
    }
  }

  updateSingBoxConfigs(configs: readonly string[]): void {
    if (configs.length === 0 || configs.some(value => !value.trim())) throw new Error('配置列表不能为空');
    const document = this.configExists() ? this.readDocument(this.options.paths.configFile) : {};
    document.protocols = {
      ...(document.protocols as Record<string, unknown> | undefined),
      sing_box_configs: [...configs],
    };
    mkdirSync(dirname(this.options.paths.configFile), { recursive: true });
    writeFileSync(this.options.paths.configFile, stringify(document, { lineWidth: 0 }), 'utf8');
  }

  private readDocument(path: string): Record<string, unknown> {
    const value = parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config root must be an object');
    return value as Record<string, unknown>;
  }
}
