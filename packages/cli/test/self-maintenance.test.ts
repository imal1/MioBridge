import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createNodeSelfMaintenanceAdapters } from '../src/self/nodeAdapters.js';
import { SelfMaintenanceService, type SelfMaintenanceAdapters } from '../src/self/service.js';

const archiveData = new TextEncoder().encode('archive');
const binaryData = new TextEncoder().encode('binary');
const digest = createHash('sha256').update(archiveData).digest('hex');

function harness(overrides: Partial<SelfMaintenanceAdapters> = {}) {
  const installed: string[] = [];
  const removed: string[] = [];
  const versions: string[] = [];
  const dashboards: string[] = [];
  const adapters: SelfMaintenanceAdapters = {
    platform: async () => ({ os: 'linux', architecture: 'x64', distro: 'test' }),
    latestVersion: async () => 'v1.2.3',
    download: async url => url.endsWith('SHA256SUMS')
      ? new TextEncoder().encode(`${digest}  miobridge-1.2.3-linux-x64.tar.gz\n`)
      : archiveData,
    sha256: async data => createHash('sha256').update(data).digest('hex'),
    extractTarGzipEntry: async () => binaryData,
    installAtomic: async (path, _data, validate) => { await validate(`${path}.tmp`); installed.push(path); },
    installDashboard: async path => { dashboards.push(path); },
    probeVersion: async () => '1.2.3',
    writeVersion: async (_path, version) => { versions.push(version); },
    remove: async path => { removed.push(path); },
    ...overrides,
  };
  const service = new SelfMaintenanceService({ currentVersion: '1.0.0', executablePath: '/home/user/.local/bin/miobridge', dashboardPath: '/home/user/.config/miobridge/dist/dashboard', adapters });
  return { service, installed, removed, versions, dashboards };
}

describe('CLI self maintenance', () => {
  it('resolves, verifies, validates, and atomically installs the latest release', async () => {
    const latestVersion = vi.fn(async () => 'v1.2.3');
    const { service, installed, versions, dashboards } = harness({ latestVersion });
    await expect(service.upgrade()).resolves.toBe('MioBridge and dashboard upgraded from 1.0.0 to 1.2.3.');
    expect(latestVersion).toHaveBeenCalledWith('imal1/miobridge');
    expect(installed).toEqual(['/home/user/.local/bin/miobridge']);
    expect(dashboards).toEqual(['/home/user/.config/miobridge/dist/dashboard']);
    expect(versions).toEqual(['1.2.3']);
  });

  it('does not replace the executable when checksum verification fails', async () => {
    const installAtomic = vi.fn();
    const { service } = harness({ sha256: async () => '0'.repeat(64), installAtomic });
    await expect(service.upgrade()).rejects.toThrow('Checksum verification failed');
    expect(installAtomic).not.toHaveBeenCalled();
  });

  it('removes only CLI-owned files and preserves runtime data by construction', async () => {
    const { service, removed } = harness();
    await expect(service.uninstall()).resolves.toContain('Configuration and data were preserved');
    expect(removed).toEqual([
      '/home/user/.local/bin/miobridge',
      '/home/user/.local/bin/.miobridge-cli-version',
    ]);
  });

  it('extracts the executable from the release tarball', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miobridge-self-tar-'));
    try {
      const binary = join(root, 'miobridge');
      const archive = join(root, 'release.tar.gz');
      const dashboard = join(root, 'dashboard');
      await mkdir(join(dashboard, 'artifact'), { recursive: true });
      await writeFile(join(dashboard, 'provider.json'), '{"schemaVersion":2}\n');
      await writeFile(join(dashboard, 'artifact', 'index.html'), '<main>current</main>\n');
      await writeFile(binary, '#!/bin/sh\necho 1.2.3\n');
      await chmod(binary, 0o755);
      execFileSync('tar', ['-czf', archive, '-C', root, 'miobridge', 'dashboard']);
      const adapters = createNodeSelfMaintenanceAdapters();
      const archiveData = await readFile(archive);
      const extracted = await adapters.extractTarGzipEntry(archiveData, 'miobridge');
      expect(new TextDecoder().decode(extracted)).toContain('echo 1.2.3');
      const installedDashboard = join(root, 'installed-dashboard');
      await adapters.installDashboard(installedDashboard, archiveData);
      expect(await readFile(join(installedDashboard, 'artifact', 'index.html'), 'utf8')).toContain('current');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
