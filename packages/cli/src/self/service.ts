import { dirname, join } from 'node:path';
import type { LinuxPlatform } from '../platform/linux.js';

export interface SelfMaintenanceAdapters {
  platform(): Promise<LinuxPlatform>;
  latestVersion(repository: string): Promise<string>;
  download(url: string): Promise<Uint8Array>;
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
    const platform = await this.options.adapters.platform();
    const version = normalizeVersion(
      this.options.targetVersion ?? await this.options.adapters.latestVersion(this.repository),
    );
    if (version === normalizeVersion(this.options.currentVersion)) return `MioBridge ${version} is already up to date.`;

    const archive = `miobridge-${version}-linux-${platform.architecture}.tar.gz`;
    const baseUrl = this.options.releaseBaseUrl ?? `https://github.com/${this.repository}/releases/download/v${version}`;
    const [archiveData, checksums] = await Promise.all([
      this.options.adapters.download(`${baseUrl}/${archive}`),
      this.options.adapters.download(`${baseUrl}/SHA256SUMS`),
    ]);
    const expected = expectedDigest(checksums, archive);
    const actual = (await this.options.adapters.sha256(archiveData)).toLowerCase();
    if (actual !== expected) throw new Error(`Checksum verification failed for ${archive}`);

    const binary = await this.options.adapters.extractTarGzipEntry(archiveData, 'miobridge');
    await this.options.adapters.installAtomic(this.options.executablePath, binary, async temporaryPath => {
      const reported = normalizeVersion(await this.options.adapters.probeVersion(temporaryPath));
      if (reported !== version) throw new Error(`Release version validation failed: expected ${version}, got ${reported}`);
    });
    await this.options.adapters.installDashboard(this.options.dashboardPath, archiveData);
    await this.options.adapters.writeVersion(join(dirname(this.options.executablePath), '.miobridge-cli-version'), version);
    return `MioBridge and dashboard upgraded from ${this.options.currentVersion} to ${version}.`;
  }

  async uninstall(): Promise<string> {
    await this.options.adapters.remove(this.options.executablePath);
    await this.options.adapters.remove(join(dirname(this.options.executablePath), '.miobridge-cli-version'));
    return 'MioBridge CLI removed. Configuration and data were preserved.';
  }
}
