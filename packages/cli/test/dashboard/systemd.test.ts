import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardSystemdService, renderDashboardUserUnit, type CommandResult, type SystemdAdapters } from '../../src/index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

async function fixture(overrides: Partial<SystemdAdapters> = {}, state: { active?: boolean; activeStatus?: string; enabled?: boolean; linger?: boolean; startFails?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'miobridge-systemd-'));
  roots.push(root);
  const dashboard = join(root, 'dist', 'dashboard');
  await mkdir(join(dashboard, 'artifact'), { recursive: true });
  await writeFile(join(dashboard, 'artifact', 'index.html'), 'fixture');
  await writeFile(join(dashboard, 'provider.json'), JSON.stringify({
    schemaVersion: 2, dashboardVersion: 'test', artifactRoot: 'artifact', spaFallback: true,
    reservedPaths: ['/api', '/health', '/subscription.txt', '/clash.yaml', '/raw.txt'],
  }));
  const calls: Array<[string, readonly string[]]> = [];
  const files = new Map<string, string>();
  const removed: string[] = [];
  const ok = (stdout = ''): CommandResult => ({ exitCode: 0, stdout, stderr: '' });
  const adapters: SystemdAdapters = {
    platform: 'linux', username: 'alice', cliPath: '/home/alice/.local/bin/miobridge', unitDirectory: join(root, 'systemd'), effectivePath: '/managed/bin:/usr/bin',
    async run(command, args) {
      calls.push([command, args]);
      if (command === 'loginctl' && args[0] === 'show-user') return ok(state.linger === false ? 'no\n' : 'yes\n');
      if (command === 'loginctl' && args[0] === 'enable-linger') { state.linger = true; return ok(); }
      if (args.includes('show-environment')) return ok();
      if (args.includes('is-active')) {
        const status = state.activeStatus ?? (state.active ? 'active' : 'inactive');
        return status === 'active' ? ok('active\n') : { exitCode: status === 'activating' ? 0 : 3, stdout: `${status}\n`, stderr: '' };
      }
      if (args.includes('is-enabled')) return state.enabled ? ok('enabled\n') : { exitCode: 1, stdout: 'disabled\n', stderr: '' };
      if (args.includes('reset-failed')) { state.activeStatus = 'inactive'; return ok(); }
      if (args.includes('enable') && args.includes('--now')) {
        if (state.startFails) return { exitCode: 1, stdout: '', stderr: 'provider crashed' };
        state.active = true; state.enabled = true; delete state.activeStatus; return ok();
      }
      if (args.includes('disable') && args.includes('--now')) { state.active = false; state.activeStatus = 'inactive'; state.enabled = false; return ok(); }
      return ok();
    },
    async writeAtomic(path, content) { files.set(path, content); },
    async remove(path) { removed.push(path); files.delete(path); },
    async isPortAvailable() { return true; },
    async waitForReady() { return true; },
    async confirmEnableLinger() { return true; },
    ...overrides,
  };
  return { service: new DashboardSystemdService({ baseDir: root, configFile: join(root, 'config.yaml'), distDir: join(root, 'dist') }, adapters), calls, files, removed, state };
}

describe('dashboard systemd user lifecycle', () => {
  it('renders a hardened safely escaped unit with the stable CLI launcher', () => {
    const unit = renderDashboardUserUnit({ cliPath: '/home/a user/bin/mio%bridge', baseDir: '/home/a user/.config/mio"bridge', host: '0.0.0.0', port: 3000, effectivePath: '/managed/bin:/usr/bin' });
    expect(unit).toContain('ExecStart="/home/a user/bin/mio%%bridge" dashboard foreground');
    expect(unit).toContain('Environment="MIOBRIDGE_CONFIG_DIR=/home/a user/.config/mio\\"bridge"');
    expect(unit).toContain('Environment="MIOBRIDGE_DASHBOARD_HOST=0.0.0.0"');
    expect(unit).toContain('Environment="MIOBRIDGE_DASHBOARD_PORT=3000"');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('Environment="PATH=/managed/bin:/usr/bin"');
    expect(unit).not.toContain('NoNewPrivileges=');
    expect(unit).not.toContain('PIDFile');
  });

  it('starts and stops idempotently and exposes journal discovery', async () => {
    const running = await fixture({}, { active: true, enabled: true });
    expect((await running.service.start()).state).toBe('running');
    expect(running.calls.some(([, args]) => args.includes('enable') && args.includes('--now'))).toBe(false);
    expect((await running.service.status()).journalCommand).toContain('journalctl --user');

    const stopped = await fixture({}, { active: false, enabled: false });
    expect((await stopped.service.stop()).state).toBe('stopped');
    expect(stopped.calls.some(([, args]) => args.includes('disable') && args.includes('--now'))).toBe(false);
    expect((await stopped.service.start()).state).toBe('running');
    expect(stopped.files.values().next().value).toContain('dashboard foreground');
    expect((await stopped.service.stop()).state).toBe('stopped');
  });

  it('reports unsupported user systemd without attempting mutation', async () => {
    const { service, files } = await fixture({ platform: 'darwin' });
    await expect(service.status()).resolves.toMatchObject({ state: 'unsupported', active: false });
    await expect(service.start()).rejects.toThrow('systemd user manager is unavailable');
    expect(files.size).toBe(0);
  });

  it('requires explicit lingering confirmation and provides manual guidance', async () => {
    const declined = await fixture({ confirmEnableLinger: async () => false }, { linger: false });
    await expect(declined.service.start()).rejects.toThrow('sudo loginctl enable-linger alice');
    const failed = await fixture({ run: async (command, args) => command === 'loginctl' && args[0] === 'enable-linger'
      ? { exitCode: 1, stdout: '', stderr: 'permission denied' }
      : command === 'loginctl' ? { exitCode: 0, stdout: 'no\n', stderr: '' }
        : args.includes('show-environment') ? { exitCode: 0, stdout: '', stderr: '' }
          : command === 'systemctl' && args[0] === 'show' ? { exitCode: 0, stdout: 'not-found\n', stderr: '' }
            : args.includes('is-active') ? { exitCode: 3, stdout: 'inactive\n', stderr: '' }
              : { exitCode: 1, stdout: 'disabled\n', stderr: '' } }, { linger: false });
    await expect(failed.service.start()).rejects.toThrow('sudo loginctl enable-linger alice');
  });

  it('blocks occupied ports and reports provider startup failure', async () => {
    const occupied = await fixture({ isPortAvailable: async () => false });
    await expect(occupied.service.start()).rejects.toThrow('already occupied');
    const failure = await fixture({}, { startFails: true });
    await expect(failure.service.start()).rejects.toThrow('provider crashed');
  });

  it('does not report a newly active service as started before HTTP is ready', async () => {
    const pending = await fixture({ waitForReady: async () => false });
    await expect(pending.service.start()).rejects.toThrow('did not become ready');
  });

  it('distinguishes a failed provider from an idempotently stopped service', async () => {
    const broken = await fixture({ run: async (command, args) => {
      if (args.includes('show-environment')) return { exitCode: 0, stdout: '', stderr: '' };
      if (command === 'loginctl') return { exitCode: 0, stdout: 'yes\n', stderr: '' };
      if (args.includes('is-active')) return { exitCode: 3, stdout: 'failed\n', stderr: '' };
      if (args.includes('is-enabled')) return { exitCode: 0, stdout: 'enabled\n', stderr: '' };
      return { exitCode: 0, stdout: 'not-found\n', stderr: '' };
    } });
    await expect(broken.service.status()).resolves.toMatchObject({ state: 'broken', enabled: true, active: false });
  });

  it('resets a failed unit before attempting a clean start', async () => {
    const failed = await fixture({}, { activeStatus: 'failed', enabled: false });
    await expect(failed.service.start()).resolves.toMatchObject({ state: 'running', active: true });
    expect(failed.calls.some(([, args]) => args.includes('reset-failed'))).toBe(true);
    expect(failed.calls.some(([, args]) => args.includes('enable') && args.includes('--now'))).toBe(true);
  });

  it('disables a failed or restart-looping unit instead of leaving it enabled', async () => {
    const failed = await fixture({}, { activeStatus: 'failed', enabled: true });
    await expect(failed.service.stop()).resolves.toMatchObject({ state: 'stopped', enabled: false });
    expect(failed.calls.some(([, args]) => args.includes('disable') && args.includes('--now'))).toBe(true);

    const restarting = await fixture({}, { activeStatus: 'activating', enabled: true });
    await expect(restarting.service.stop()).resolves.toMatchObject({ state: 'stopped', enabled: false });
    expect(restarting.calls.some(([, args]) => args.includes('disable') && args.includes('--now'))).toBe(true);
  });

  it('restarts in place without rewriting the unit definition', async () => {
    const { service, calls, files } = await fixture({}, { active: true, enabled: true });
    await service.restart();
    expect(calls.some(([, args]) => args.includes('restart'))).toBe(true);
    // 不得重写单元文件：如果 upgrade 是从别的路径运行的，重写会把
    // ExecStart 劫持到那个路径，服务立刻进入 203/EXEC 崩溃循环。
    expect(files.size).toBe(0);
  });

  it('surfaces a restart that never becomes ready', async () => {
    const { service } = await fixture({ waitForReady: async () => false }, { active: true, enabled: true });
    await expect(service.restart()).rejects.toThrow(/journalctl/);
  });

  it('surfaces a restart the service manager rejects', async () => {
    const { service } = await fixture({
      async run(command, args) {
        if (args.includes('restart')) return { exitCode: 1, stdout: '', stderr: 'unit masked' };
        return { exitCode: 0, stdout: 'active\n', stderr: '' };
      },
    }, { active: true, enabled: true });
    await expect(service.restart()).rejects.toThrow(/unit masked/);
  });

  it('removes the managed unit and reloads systemd during CLI uninstall', async () => {
    const installed = await fixture({}, { active: true, enabled: true });
    await installed.service.uninstall();
    expect(installed.removed).toEqual([installed.service.unitPath]);
    expect(installed.calls.some(([, args]) => args.includes('disable') && args.includes('--now'))).toBe(true);
    expect(installed.calls.some(([, args]) => args.includes('daemon-reload'))).toBe(true);
  });

  it('still removes the managed unit when user systemd is unavailable', async () => {
    const unsupported = await fixture({ platform: 'darwin' });
    await unsupported.service.uninstall();
    expect(unsupported.removed).toEqual([unsupported.service.unitPath]);
    expect(unsupported.calls).toEqual([]);
  });
});
