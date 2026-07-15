import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
  getConfigPath(): string { return this.options.paths.configFile; }
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

  parseConfig(source: string): FullConfig {
    const value = parse(source);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config root must be an object');
    return value as FullConfig;
  }

  getLastGoodConfig(): FullConfig {
    const backupPath = `${this.options.paths.configFile}.last-good`;
    if (!existsSync(backupPath)) throw new Error('没有可恢复的 last-good 配置');
    return this.parseConfig(readFileSync(backupPath, 'utf8'));
  }

  replaceConfig(document: FullConfig): { backupPath?: string } {
    const path = this.options.paths.configFile;
    const temporary = `${path}.tmp-${process.pid}`;
    const backupPath = `${path}.last-good`;
    mkdirSync(dirname(path), { recursive: true });
    let hasBackup = false;
    try {
      if (existsSync(path)) {
        copyFileSync(path, backupPath);
        chmodSync(backupPath, 0o600);
        hasBackup = true;
      }
      writeFileSync(temporary, stringify(document, { lineWidth: 0 }), { encoding: 'utf8', mode: 0o600 });
      this.parseConfig(readFileSync(temporary, 'utf8'));
      renameSync(temporary, path);
      chmodSync(path, 0o600);
      return hasBackup ? { backupPath } : {};
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  restoreLastGood(): { restored: true; backupPath: string } {
    const path = this.options.paths.configFile;
    const backupPath = `${path}.last-good`;
    const temporary = `${path}.restore-${process.pid}`;
    const preRestore = `${path}.pre-restore`;
    if (!existsSync(backupPath)) throw new Error('没有可恢复的 last-good 配置');
    try {
      copyFileSync(backupPath, temporary);
      this.parseConfig(readFileSync(temporary, 'utf8'));
      if (existsSync(path)) copyFileSync(path, preRestore);
      renameSync(temporary, path);
      chmodSync(path, 0o600);
      return { restored: true, backupPath: preRestore };
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  updateSingBoxConfigs(configs: readonly string[]): void {
    if (configs.length === 0 || configs.some(value => !value.trim())) throw new Error('配置列表不能为空');
    const document = this.configExists() ? this.readDocument(this.options.paths.configFile) : {};
    document.protocols = {
      ...(document.protocols as Record<string, unknown> | undefined),
      sing_box_configs: [...configs],
    };
    this.replaceConfig(document as FullConfig);
  }

  private readDocument(path: string): Record<string, unknown> {
    const value = parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config root must be an object');
    return value as Record<string, unknown>;
  }
}
