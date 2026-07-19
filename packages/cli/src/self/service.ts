import { dirname, join } from 'node:path';
import type { LinuxPlatform } from '../platform/linux.js';

export interface DownloadProgressHooks {
  onProgress?(receivedBytes: number, totalBytes?: number): void;
  onRetry?(attempt: number, error: unknown): void;
}

/** 升级完成后可能仍在运行旧版本的 dashboard 形态。 */
export type RunningDashboard = 'systemd' | 'external' | 'none';

export interface SelfMaintenanceAdapters {
  platform(): Promise<LinuxPlatform>;
  latestVersion(repository: string): Promise<string>;
  download(url: string, hooks?: DownloadProgressHooks): Promise<Uint8Array>;
  sha256(data: Uint8Array): Promise<string>;
  extractTarGzipEntry(data: Uint8Array, entry: string): Promise<Uint8Array>;
  installAtomic(path: string, data: Uint8Array, validate: (temporaryPath: string) => Promise<void>): Promise<void>;
  installDashboard(path: string, archive: Uint8Array): Promise<void>;
  probeVersion(path: string): Promise<string>;
  writeVersion(path: string, version: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface SelfMaintenanceOptions {
  readonly currentVersion: string;
  readonly executablePath: string;
  readonly adapters: SelfMaintenanceAdapters;
  readonly repository?: string;
  readonly targetVersion?: string;
  readonly releaseBaseUrl?: string;
  readonly dashboardPath: string;
  readonly configDir: string;
  /** 每个阶段的人类可读进度；不提供则静默（保持旧行为）。 */
  readonly progress?: (message: string) => void;
  /**
   * 升级完成后接管仍在运行旧版本的 dashboard。systemd 托管的直接重启；
   * 前台进程挂在用户自己的终端上，杀掉也无法原地拉起，只能明确警告。
   */
  readonly serviceControl?: {
    detect(): Promise<RunningDashboard>;
    restart(): Promise<void>;
  };
}

function normalizeVersion(version: string): string {
  const normalized = version.trim().replace(/^v/, '');
  if (!normalized || !/^[0-9A-Za-z._-]+$/.test(normalized)) throw new Error(`Invalid MioBridge version: ${version}`);
  return normalized;
}

function expectedDigest(checksums: Uint8Array, archive: string): string {
  const line = new TextDecoder().decode(checksums).split(/\r?\n/).find(value => {
    const [, name] = value.trim().split(/\s+/, 2);
    return name?.replace(/^\*/, '') === archive;
  });
  const digest = line?.trim().split(/\s+/, 1)[0];
  if (!digest || !/^[a-fA-F0-9]{64}$/.test(digest)) throw new Error(`Checksum entry missing for ${archive}`);
  return digest.toLowerCase();
}

export class SelfMaintenanceService {
  private readonly repository: string;

  constructor(private readonly options: SelfMaintenanceOptions) {
    this.repository = options.repository ?? 'imal1/miobridge';
  }

  async upgrade(): Promise<string> {
    const progress = this.options.progress ?? (() => undefined);
    const platform = await this.options.adapters.platform();
    if (!this.options.targetVersion) progress(`Resolving latest release of ${this.repository}...`);
    const version = normalizeVersion(
      this.options.targetVersion ?? await this.options.adapters.latestVersion(this.repository),
    );
    if (version === normalizeVersion(this.options.currentVersion)) return `MioBridge ${version} is already up to date.`;

    const archive = `miobridge-${version}-linux-${platform.architecture}.tar.gz`;
    const baseUrl = this.options.releaseBaseUrl ?? `https://github.com/${this.repository}/releases/download/v${version}`;
    progress(`Downloading ${archive} from ${baseUrl}...`);
    const megabytes = (bytes: number) => (bytes / 1048576).toFixed(1);
    let reportedPercent = -25;
    let reportedBytes = 0;
    const [archiveData, checksums] = await Promise.all([
      this.options.adapters.download(`${baseUrl}/${archive}`, {
        onProgress: (received, total) => {
          // 有总量按 25% 一档报，没有就每 8 MiB 报一次；再密就是刷屏了。
          if (total) {
            const percent = Math.floor((received / total) * 100);
            if (percent >= reportedPercent + 25 || (percent === 100 && reportedPercent < 100)) {
              reportedPercent = percent;
              progress(`Downloading ${archive}: ${percent}% (${megabytes(received)}/${megabytes(total)} MB)`);
            }
          } else if (received >= reportedBytes + 8 * 1048576) {
            reportedBytes = received;
            progress(`Downloading ${archive}: ${megabytes(received)} MB received`);
          }
        },
        onRetry: (attempt, error) => {
          const reason = error instanceof Error ? error.message : String(error);
          progress(`Download interrupted (${reason}); starting retry ${attempt + 1}...`);
        },
      }),
      this.options.adapters.download(`${baseUrl}/SHA256SUMS`),
    ]);
    progress('Verifying SHA-256 checksum...');
    const expected = expectedDigest(checksums, archive);
    const actual = (await this.options.adapters.sha256(archiveData)).toLowerCase();
    if (actual !== expected) throw new Error(`Checksum verification failed for ${archive}`);

    progress(`Installing MioBridge ${version} (CLI + dashboard)...`);
    const binary = await this.options.adapters.extractTarGzipEntry(archiveData, 'miobridge');
    await this.options.adapters.installAtomic(this.options.executablePath, binary, async temporaryPath => {
      const reported = normalizeVersion(await this.options.adapters.probeVersion(temporaryPath));
      if (reported !== version) throw new Error(`Release version validation failed: expected ${version}, got ${reported}`);
    });
    await this.options.adapters.installDashboard(this.options.dashboardPath, archiveData);
    await this.options.adapters.writeVersion(join(dirname(this.options.executablePath), '.miobridge-cli-version'), version);
    const upgraded = `MioBridge and dashboard upgraded from ${this.options.currentVersion} to ${version}.`;
    return `${upgraded}${await this.handOverRunningDashboard(version, progress)}`;
  }

  /** 磁盘上的新版本就位后，处理还在跑旧版本的服务；返回追加到结果末尾的说明。 */
  private async handOverRunningDashboard(version: string, progress: (message: string) => void): Promise<string> {
    const control = this.options.serviceControl;
    if (!control) return '';
    let running: RunningDashboard = 'none';
    try { running = await control.detect(); } catch { return ''; } // 探测失败不能拖垮已完成的升级。
    if (running === 'external') {
      return ` A running dashboard not managed by systemd still serves the old version; restart it manually to apply ${version}.`;
    }
    if (running !== 'systemd') return '';
    progress('Restarting dashboard service...');
    try {
      await control.restart();
      return ' Dashboard service restarted.';
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return ` Dashboard restart failed: ${reason} Run "miobridge dashboard start" manually.`;
    }
  }

  async uninstall(options: { readonly purge?: boolean } = {}): Promise<string> {
    await this.options.adapters.remove(this.options.executablePath);
    await this.options.adapters.remove(join(dirname(this.options.executablePath), '.miobridge-cli-version'));
    if (options.purge) {
      await this.options.adapters.remove(this.options.configDir);
      return 'MioBridge CLI, configuration, data, and managed dependencies removed.';
    }
    return 'MioBridge CLI removed. Configuration and data were preserved.';
  }
}
