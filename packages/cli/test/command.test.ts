import { describe, expect, it, vi } from 'vitest';
import { formatStatus, parseCommand, runCli, type CliCore } from '../src/index.js';

function harness(core: CliCore) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const createCore = vi.fn(() => core);
  return {
    stdout,
    stderr,
    createCore,
    dependencies: {
      createCore,
      output: { stdout: (message: string) => stdout.push(message), stderr: (message: string) => stderr.push(message) },
      version: '9.8.7',
    },
  };
}

const status = {
  subscriptionExists: true,
  clashExists: false,
  rawExists: true,
  mihomoAvailable: false,
  uptime: 12,
  version: '9.8.7',
  nodesCount: 3,
};

describe('CLI command contract', () => {
  it('parses the stable command surface and rejects invalid options', () => {
    expect(parseCommand(['setup'])).toEqual({ kind: 'setup', assumeYes: false });
    expect(parseCommand(['setup', '--yes'])).toEqual({ kind: 'setup', assumeYes: true });
    expect(parseCommand(['setup', '--yes', '--no-local-node'])).toEqual({ kind: 'setup', assumeYes: true, localNode: false });
    expect(parseCommand(['nodes', 'configure'])).toEqual({ kind: 'nodes-configure' });
    expect(parseCommand(['nodes', 'configure', '--local-node'])).toEqual({ kind: 'nodes-configure', localNode: true });
    expect(parseCommand(['upgrade'])).toEqual({ kind: 'upgrade' });
    expect(parseCommand(['uninstall'])).toEqual({ kind: 'uninstall', purge: false });
    expect(parseCommand(['uninstall', '--purge'])).toEqual({ kind: 'uninstall', purge: true });
    expect(parseCommand(['update'])).toEqual({ kind: 'update' });
    expect(parseCommand(['status'])).toEqual({ kind: 'status', json: false });
    expect(parseCommand(['status', '--json'])).toEqual({ kind: 'status', json: true });
    expect(parseCommand(['--help'])).toEqual({ kind: 'help' });
    expect(parseCommand(['--version'])).toEqual({ kind: 'version' });
    expect(parseCommand(['dashboard', 'foreground'])).toEqual({ kind: 'dashboard-foreground' });
    expect(parseCommand(['dashboard', 'start'])).toEqual({ kind: 'dashboard-daemon', action: 'start', json: false });
    expect(parseCommand(['dashboard', 'status', '--json'])).toEqual({ kind: 'dashboard-daemon', action: 'status', json: true });
    expect(() => parseCommand(['status', '--verbose'])).toThrow('Unexpected argument');
    expect(() => parseCommand(['setup', '--local-node', '--no-local-node'])).toThrow('Choose only one');
    expect(() => parseCommand(['dashboard'])).toThrow('Missing dashboard action');
  });

  it('keeps dashboard daemon JSON decoration-free and does not compose core', async () => {
    const run = harness({ updateSubscription: vi.fn(), getStatus: vi.fn() } as unknown as CliCore);
    const status = { state: 'running' as const, active: true, enabled: true, linger: true, unitPath: '/unit', journalCommand: 'journalctl --user -u unit', message: 'running' };
    const daemon = vi.fn(async () => status);
    expect(await runCli(['dashboard', 'status', '--json'], { ...run.dependencies, dashboard: { foreground: vi.fn(), daemon } })).toBe(0);
    expect(run.stdout).toEqual([JSON.stringify(status)]);
    expect(run.stderr).toEqual([]);
    expect(run.createCore).not.toHaveBeenCalled();
  });

  it('runs dashboard foreground without composing core and forwards its status', async () => {
    const run = harness({ updateSubscription: vi.fn(), getStatus: vi.fn() } as unknown as CliCore);
    const foreground = vi.fn(async () => ({ exitCode: 23, healthUrl: 'http://127.0.0.1:3000/health' }));
    expect(await runCli(['dashboard', 'foreground'], { ...run.dependencies, dashboard: { foreground } })).toBe(23);
    expect(foreground).toHaveBeenCalledOnce();
    expect(run.createCore).not.toHaveBeenCalled();
    expect(run.stderr).toEqual(['Dashboard exited with status 23']);
  });

  it('runs setup without composing core', async () => {
    const run = harness({ updateSubscription: vi.fn(), getStatus: vi.fn() } as unknown as CliCore);
    const setup = { run: vi.fn(async () => [{ name: 'sing-box' as const, required: false, capability: 'optional', origin: 'missing' as const }]) };
    const localNode = { configure: vi.fn(async () => ({ enabled: false, changed: false, message: 'disabled' })) };
    const dependencies = { ...run.dependencies, setup, localNode };
    expect(await runCli(['setup'], dependencies)).toBe(0);
    expect(setup.run).toHaveBeenCalledWith({ assumeYes: false });
    expect(localNode.configure).toHaveBeenCalledWith({ assumeYes: false });
    expect(run.createCore).not.toHaveBeenCalled();
    expect(run.stdout[0]).toContain('sing-box: missing');
    expect(run.stdout[0]).toContain('local-node: disabled');
  });

  it('configures the local node later without composing core', async () => {
    const run = harness({ updateSubscription: vi.fn(), getStatus: vi.fn() } as unknown as CliCore);
    const localNode = { configure: vi.fn(async () => ({ enabled: true, changed: true, message: 'enabled' })) };
    expect(await runCli(['nodes', 'configure', '--local-node'], { ...run.dependencies, localNode })).toBe(0);
    expect(localNode.configure).toHaveBeenCalledWith({ enabled: true });
    expect(run.stdout).toEqual(['local-node: enabled [changed] — enabled']);
    expect(run.createCore).not.toHaveBeenCalled();
  });

  it('runs upgrade and uninstall through binary maintenance adapters', async () => {
    const run = harness({ updateSubscription: vi.fn(), getStatus: vi.fn() } as unknown as CliCore);
    const maintenance = { upgrade: vi.fn(async () => 'upgraded'), uninstall: vi.fn(async () => 'removed') };
    expect(await runCli(['upgrade'], { ...run.dependencies, maintenance })).toBe(0);
    expect(await runCli(['uninstall'], { ...run.dependencies, maintenance })).toBe(0);
    expect(await runCli(['uninstall', '--purge'], { ...run.dependencies, maintenance })).toBe(0);
    expect(maintenance.uninstall).toHaveBeenNthCalledWith(1, false);
    expect(maintenance.uninstall).toHaveBeenNthCalledWith(2, true);
    expect(run.stdout).toEqual(['upgraded', 'removed', 'removed']);
    expect(run.createCore).not.toHaveBeenCalled();
  });

  it('handles help and version without composing core', async () => {
    const core = { updateSubscription: vi.fn(), getStatus: vi.fn() } as unknown as CliCore;
    const help = harness(core);
    expect(await runCli(['--help'], help.dependencies)).toBe(0);
    expect(help.stdout[0]).toContain('MioBridge 9.8.7');
    expect(help.createCore).not.toHaveBeenCalled();

    const version = harness(core);
    expect(await runCli(['--version'], version.dependencies)).toBe(0);
    expect(version.stdout).toEqual(['9.8.7']);
    expect(version.stderr).toEqual([]);
  });

  it('uses one injected composition for update', async () => {
    const updateSubscription = vi.fn(async () => ({
      success: true, message: 'updated', timestamp: '2026-01-01T00:00:00.000Z',
      nodesCount: 2, clashGenerated: true, backupCreated: '/runtime/backup.txt',
    }));
    const run = harness({ updateSubscription, getStatus: vi.fn() });
    expect(await runCli(['update'], run.dependencies)).toBe(0);
    expect(run.createCore).toHaveBeenCalledTimes(1);
    expect(updateSubscription).toHaveBeenCalledTimes(1);
    expect(run.stdout).toEqual(['updated\nNodes: 2\nClash generated: yes\nBackup: /runtime/backup.txt']);
    expect(run.stderr).toEqual([]);
  });

  it('keeps JSON status output decoration-free and deterministic', async () => {
    const run = harness({ updateSubscription: vi.fn(), getStatus: vi.fn(async () => status) });
    expect(await runCli(['status', '--json'], run.dependencies)).toBe(0);
    expect(run.createCore).toHaveBeenCalledTimes(1);
    expect(run.stderr).toEqual([]);
    expect(run.stdout).toEqual([JSON.stringify(status)]);
    expect(JSON.parse(run.stdout[0]!)).toEqual(status);
  });

  it('formats human status and maps usage/domain failures to exit codes', async () => {
    expect(formatStatus(status)).toContain('Nodes: 3');
    const invalid = harness({ updateSubscription: vi.fn(), getStatus: vi.fn() } as unknown as CliCore);
    expect(await runCli(['nope'], invalid.dependencies)).toBe(2);
    expect(invalid.stderr[0]).toContain('Unknown command');
    expect(invalid.createCore).not.toHaveBeenCalled();

    const failed = harness({ updateSubscription: vi.fn(async () => { throw new Error('no sources'); }), getStatus: vi.fn() });
    expect(await runCli(['update'], failed.dependencies)).toBe(1);
    expect(failed.stdout).toEqual([]);
    expect(failed.stderr).toEqual(['Error: no sources']);
  });
});
