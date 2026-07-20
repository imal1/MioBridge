import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createNodeSelfMaintenanceAdapters } from '../src/self/nodeAdapters.js';
import { SelfMaintenanceService, type SelfMaintenanceAdapters, type SelfMaintenanceOptions } from '../src/self/service.js';

const archiveData = new TextEncoder().encode('archive');
const binaryData = new TextEncoder().encode('binary');
const digest = createHash('sha256').update(archiveData).digest('hex');

function harness(
  overrides: Partial<SelfMaintenanceAdapters> = {},
  options: Partial<Omit<SelfMaintenanceOptions, 'adapters'>> = {},
) {
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
  const service = new SelfMaintenanceService({ currentVersion: '1.0.0', executablePath: '/home/user/.local/bin/miobridge', dashboardPath: '/home/user/.config/miobridge/dist/dashboard', configDir: '/home/user/.config/miobridge', adapters, ...options });
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

  it('removes the complete runtime directory only with explicit purge', async () => {
    const { service, removed } = harness();
    await expect(service.uninstall({ purge: true })).resolves.toContain('managed dependencies removed');
    expect(removed).toEqual([
      '/home/user/.local/bin/miobridge',
      '/home/user/.local/bin/.miobridge-cli-version',
      '/home/user/.config/miobridge',
    ]);
  });

  it('reports each upgrade phase through the progress callback', async () => {
    const events: string[] = [];
    const { service } = harness({}, { progress: message => events.push(message) });
    await service.upgrade();
    const phases = ['Resolving', 'Downloading', 'Verifying', 'Installing'];
    const indexes = phases.map(phase => events.findIndex(event => event.startsWith(phase)));
    // 每个阶段都要出现，且按顺序出现——用户必须能区分「在下载」和「卡死了」。
    expect(indexes.every(index => index >= 0)).toBe(true);
    expect([...indexes]).toEqual([...indexes].sort((a, b) => a - b));
  });

  it('skips the resolve phase when a target version is pinned', async () => {
    const events: string[] = [];
    const latestVersion = vi.fn();
    const { service } = harness({ latestVersion }, { targetVersion: '1.2.3', progress: message => events.push(message) });
    await service.upgrade();
    expect(latestVersion).not.toHaveBeenCalled();
    expect(events.some(event => event.startsWith('Resolving'))).toBe(false);
  });

  it('relays download progress and retry notices', async () => {
    const events: string[] = [];
    const { service } = harness({
      download: async (url, hooks) => {
        if (url.endsWith('SHA256SUMS')) return new TextEncoder().encode(`${digest}  miobridge-1.2.3-linux-x64.tar.gz\n`);
        hooks?.onRetry?.(1, new Error('socket hang up'));
        hooks?.onProgress?.(archiveData.length, archiveData.length);
        return archiveData;
      },
    }, { progress: message => events.push(message) });
    await service.upgrade();
    expect(events.some(event => event.includes('retry'))).toBe(true);
    expect(events.some(event => /100%/.test(event))).toBe(true);
  });

  it('restarts a running systemd dashboard after the upgrade', async () => {
    const refreshUnit = vi.fn(async () => undefined);
    const restart = vi.fn(async () => undefined);
    const { service } = harness({}, { serviceControl: { detect: async () => 'systemd', refreshUnit, restart } });
    await expect(service.upgrade()).resolves.toContain('definition refreshed and restarted');
    expect(refreshUnit).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledOnce();
    expect(refreshUnit.mock.invocationCallOrder[0]).toBeLessThan(restart.mock.invocationCallOrder[0]!);
  });

  it('leaves stopped dashboards alone', async () => {
    const refreshUnit = vi.fn(async () => undefined);
    const restart = vi.fn(async () => undefined);
    const { service } = harness({}, { serviceControl: { detect: async () => 'none', refreshUnit, restart } });
    await expect(service.upgrade()).resolves.toBe('MioBridge and dashboard upgraded from 1.0.0 to 1.2.3.');
    expect(refreshUnit).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it('warns about an unmanaged running dashboard instead of touching it', async () => {
    const refreshUnit = vi.fn(async () => undefined);
    const restart = vi.fn(async () => undefined);
    const { service } = harness({}, { serviceControl: { detect: async () => 'external', refreshUnit, restart } });
    // 前台进程挂在用户自己的终端上，杀掉它无法原地重启，只能明确警告。
    await expect(service.upgrade()).resolves.toContain('restart it manually');
    expect(refreshUnit).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it('does not fail the finished upgrade when the restart fails', async () => {
    const refreshUnit = vi.fn(async () => undefined);
    const restart = vi.fn(async () => { throw new Error('systemctl busy'); });
    const { service } = harness({}, { serviceControl: { detect: async () => 'systemd', refreshUnit, restart } });
    // 二进制和 dashboard 已经装好了，重启失败只能降级为带指引的警告。
    const message = await service.upgrade();
    expect(message).toContain('upgraded from 1.0.0 to 1.2.3');
    expect(message).toContain('miobridge dashboard start');
  });

  it('does not restart when refreshing the managed unit fails', async () => {
    const refreshUnit = vi.fn(async () => { throw new Error('daemon-reload failed'); });
    const restart = vi.fn(async () => undefined);
    const { service } = harness({}, { serviceControl: { detect: async () => 'systemd', refreshUnit, restart } });
    const message = await service.upgrade();
    expect(message).toContain('refresh/restart failed: daemon-reload failed');
    expect(restart).not.toHaveBeenCalled();
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
      vi.stubGlobal('DecompressionStream', undefined);
      try {
        const adapters = createNodeSelfMaintenanceAdapters();
        const archiveData = await readFile(archive);
        const extracted = await adapters.extractTarGzipEntry(archiveData, 'miobridge');
        expect(new TextDecoder().decode(extracted)).toContain('echo 1.2.3');
        const installedDashboard = join(root, 'installed-dashboard');
        await adapters.installDashboard(installedDashboard, archiveData);
        expect(await readFile(join(installedDashboard, 'artifact', 'index.html'), 'utf8')).toContain('current');
      } finally {
        vi.unstubAllGlobals();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
