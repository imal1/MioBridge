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
    expect(parseCommand(['update'])).toEqual({ kind: 'update' });
    expect(parseCommand(['status'])).toEqual({ kind: 'status', json: false });
    expect(parseCommand(['status', '--json'])).toEqual({ kind: 'status', json: true });
    expect(parseCommand(['--help'])).toEqual({ kind: 'help' });
    expect(parseCommand(['--version'])).toEqual({ kind: 'version' });
    expect(() => parseCommand(['status', '--verbose'])).toThrow('Unexpected argument');
    expect(() => parseCommand(['dashboard'])).toThrow('Unknown command');
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
