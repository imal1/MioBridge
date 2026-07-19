import { describe, expect, it, vi } from 'vitest';
import { formatMetrics, formatStatus, helpText, parseCommand, runCli, type CliCore } from '../src/index.js';

const metrics = {
  timestamp: '2026-01-01T00:00:00.000Z',
  version: '9.8.7',
  uptime: 12,
  enabledNodes: 3,
  onlineNodes: 2,
  sources: 4,
  proxies: 8,
  mihomoAvailable: true,
  artifacts: {
    raw: { exists: true, ageSeconds: 10, size: 100 },
    subscription: { exists: true, ageSeconds: 20, size: 200 },
    clash: { exists: false },
  },
  lastGeneration: { status: 'partial' as const, timestamp: '2026-01-01T00:00:00.000Z', durationMs: 321 },
};

function createCore(overrides: Partial<CliCore> = {}): CliCore {
  return {
    updateSubscription: vi.fn(async () => ({
      success: true, message: 'updated', timestamp: '2026-01-01T00:00:00.000Z',
      nodesCount: 2, clashGenerated: true, backupCreated: '/runtime/backup.txt',
    })),
    getStatus: vi.fn(async () => status),
    getConfigPath: vi.fn(() => '/runtime/config.yaml'),
    getEffectiveConfig: vi.fn(() => ({ app: { port: 3000, log_level: 'info' } })),
    getConfigValue: vi.fn(() => null),
    setConfigValue: vi.fn(async (path, value) => ({ path, value, applied: true, restartRequired: false })),
    validateConfig: vi.fn(() => ({ valid: true, issues: [] })),
    getLocalLogs: vi.fn(async () => ({ entries: [], files: [], updatedAt: '2026-01-01T00:00:00.000Z' })),
    followLocalLogs: vi.fn(async function* () {}),
    getMetricsSnapshot: vi.fn(async () => metrics),
    ...overrides,
  };
}

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
    expect(() => parseCommand(['setup', '--local-node', '--no-local-node'])).toThrow('Choose only one');
    expect(() => parseCommand(['nodes'])).toThrow('Missing nodes action');
    expect(parseCommand(['upgrade'])).toEqual({ kind: 'upgrade' });
    expect(parseCommand(['uninstall'])).toEqual({ kind: 'uninstall', purge: false });
    expect(parseCommand(['uninstall', '--purge'])).toEqual({ kind: 'uninstall', purge: true });
    expect(parseCommand(['update'])).toEqual({ kind: 'update', json: false });
    expect(parseCommand(['update', '--json'])).toEqual({ kind: 'update', json: true });
    expect(parseCommand(['status'])).toEqual({ kind: 'status', json: false });
    expect(parseCommand(['status', '--json'])).toEqual({ kind: 'status', json: true });
    expect(parseCommand(['--help'])).toEqual({ kind: 'help' });
    expect(parseCommand(['--version'])).toEqual({ kind: 'version' });
    expect(parseCommand(['dashboard', 'foreground'])).toEqual({ kind: 'dashboard-foreground' });
    expect(parseCommand(['dashboard', 'start'])).toEqual({ kind: 'dashboard-daemon', action: 'start', json: false });
    expect(parseCommand(['dashboard', 'status', '--json'])).toEqual({ kind: 'dashboard-daemon', action: 'status', json: true });
    expect(parseCommand(['config', 'path'])).toEqual({ kind: 'config-path' });
    expect(parseCommand(['config', 'show', '--json'])).toEqual({ kind: 'config-show', json: true });
    expect(parseCommand(['config', 'get', 'app.port'])).toEqual({ kind: 'config-get', path: 'app.port', json: false });
    expect(parseCommand(['config', 'set', 'app.port', '4321'])).toEqual({ kind: 'config-set', path: 'app.port', value: 4321 });
    expect(parseCommand(['config', 'validate', '--file', '/tmp/config.yaml', '--json'])).toEqual({
      kind: 'config-validate', file: '/tmp/config.yaml', json: true,
    });
    expect(parseCommand(['logs'])).toEqual({ kind: 'logs', lines: 200, follow: false });
    expect(parseCommand(['logs', '--lines', '20', '--level', 'error', '--follow'])).toEqual({
      kind: 'logs', lines: 20, level: 'error', follow: true,
    });
    expect(parseCommand(['metrics', '--json'])).toEqual({ kind: 'metrics', json: true });
    expect(() => parseCommand(['status', '--verbose'])).toThrow('Unexpected argument');
    expect(() => parseCommand(['dashboard', 'start', '--json'])).toThrow('Unexpected argument');
    expect(() => parseCommand(['config', 'set', 'app.port', '[broken'])).toThrow();
    expect(() => parseCommand(['config', 'get', '--json'])).toThrow('Unknown config action');
    expect(() => parseCommand(['config', 'validate', '--file', '--json'])).toThrow('Unexpected argument');
    expect(() => parseCommand(['config', 'validate', '--json', '--json'])).toThrow('Unexpected argument');
    expect(() => parseCommand(['logs', '--level', '--follow'])).toThrow('Unexpected argument');
    expect(() => parseCommand(['logs', '--lines', '0'])).toThrow('--lines must be an integer');
    expect(() => parseCommand(['dashboard'])).toThrow('Missing dashboard action');
  });

  it('publishes only the locked local command surface in help', () => {
    for (const command of ['setup', 'upgrade', 'uninstall', 'update', 'status', 'config', 'logs', 'metrics', 'dashboard']) {
      expect(helpText).toMatch(new RegExp(`\\n  ${command}(?: |\\n)`));
    }
    for (const excluded of ['node', 'deploy', 'agent', 'runtime', 'subscription', 'artifact', 'policy', 'notification', 'task', 'watch', 'retry', 'cancel']) {
      expect(helpText).not.toMatch(new RegExp(`\\n  ${excluded}(?: |\\n)`));
    }
  });

  it('keeps dashboard daemon JSON decoration-free and does not compose core', async () => {
    const run = harness(createCore());
    const status = { state: 'running' as const, active: true, enabled: true, linger: true, unitPath: '/unit', journalCommand: 'journalctl --user -u unit', message: 'running' };
    const daemon = vi.fn(async () => status);
    expect(await runCli(['dashboard', 'status', '--json'], { ...run.dependencies, dashboard: { foreground: vi.fn(), daemon } })).toBe(0);
    expect(run.stdout).toEqual([JSON.stringify(status)]);
    expect(run.stderr).toEqual([]);
    expect(run.createCore).not.toHaveBeenCalled();
  });

  it('runs dashboard foreground without composing core and forwards its status', async () => {
    const run = harness(createCore());
    const foreground = vi.fn(async () => ({ exitCode: 23, healthUrl: 'http://127.0.0.1:3000/health' }));
    expect(await runCli(['dashboard', 'foreground'], { ...run.dependencies, dashboard: { foreground } })).toBe(1);
    expect(foreground).toHaveBeenCalledOnce();
    expect(run.createCore).not.toHaveBeenCalled();
    expect(run.stderr).toEqual(['Dashboard exited with status 23']);
  });

  it('runs setup without composing core', async () => {
    const run = harness(createCore());
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
    const run = harness(createCore());
    const localNode = { configure: vi.fn(async () => ({ enabled: true, changed: true, message: 'enabled' })) };
    expect(await runCli(['nodes', 'configure', '--local-node'], { ...run.dependencies, localNode })).toBe(0);
    expect(localNode.configure).toHaveBeenCalledWith({ enabled: true });
    expect(run.stdout).toEqual(['local-node: enabled [changed] — enabled']);
    expect(run.createCore).not.toHaveBeenCalled();
  });

  it('runs upgrade and uninstall through binary maintenance adapters', async () => {
    const run = harness(createCore());
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
    const core = createCore();
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
    const run = harness(createCore({ updateSubscription }));
    expect(await runCli(['update'], run.dependencies)).toBe(0);
    expect(run.createCore).toHaveBeenCalledTimes(1);
    expect(updateSubscription).toHaveBeenCalledTimes(1);
    expect(run.stdout).toEqual(['updated\nNodes: 2\nClash generated: yes\nBackup: /runtime/backup.txt']);
    expect(run.stderr).toEqual([]);
  });

  it('keeps JSON status output decoration-free and deterministic', async () => {
    const run = harness(createCore({ getStatus: vi.fn(async () => status) }));
    expect(await runCli(['status', '--json'], run.dependencies)).toBe(0);
    expect(run.createCore).toHaveBeenCalledTimes(1);
    expect(run.stderr).toEqual([]);
    expect(run.stdout).toEqual([JSON.stringify(status)]);
    expect(JSON.parse(run.stdout[0]!)).toEqual(status);
  });

  it('formats human status and maps usage/domain failures to exit codes', async () => {
    expect(formatStatus(status)).toContain('Nodes: 3');
    const invalid = harness(createCore());
    expect(await runCli(['nope'], invalid.dependencies)).toBe(2);
    expect(invalid.stderr[0]).toContain('Unknown command');
    expect(invalid.createCore).not.toHaveBeenCalled();

    const failed = harness(createCore({ updateSubscription: vi.fn(async () => { throw new Error('no sources'); }) }));
    expect(await runCli(['update'], failed.dependencies)).toBe(1);
    expect(failed.stdout).toEqual([]);
    expect(failed.stderr).toEqual(['Error: no sources']);
  });

  it('keeps update JSON pure and maps partial success to exit code 3', async () => {
    const result = {
      success: true, message: 'raw generated, clash unavailable', timestamp: '2026-01-01T00:00:00.000Z',
      nodesCount: 2, clashGenerated: false, backupCreated: '/runtime/backup.txt', warnings: ['mihomo unavailable'],
    };
    const run = harness(createCore({ updateSubscription: vi.fn(async () => result) }));
    expect(await runCli(['update', '--json'], run.dependencies)).toBe(3);
    expect(run.stdout).toEqual([JSON.stringify(result)]);
    expect(run.stderr).toEqual([]);
    expect(JSON.parse(run.stdout[0]!)).toEqual(result);
  });

  it('implements config path, show, get, set and validate through the core facade', async () => {
    const setConfigValue = vi.fn(async (path: string, value: unknown) => ({
      path, value, applied: true, restartRequired: true, backupPath: '/runtime/config.last-good.yaml',
    }));
    const validateConfig = vi.fn((source?: string) => source?.includes('broken')
      ? { valid: false, issues: [{ path: 'app.port', message: '必须是 number' }] }
      : { valid: true, issues: [] });
    const core = createCore({
      getConfigValue: vi.fn(path => path === 'app.port' ? 3000 : path === 'protocols.sing_box_configs' ? ['one', 'two'] : null),
      setConfigValue,
      validateConfig,
    });

    const pathRun = harness(core);
    expect(await runCli(['config', 'path'], pathRun.dependencies)).toBe(0);
    expect(pathRun.stdout).toEqual(['/runtime/config.yaml']);

    const showRun = harness(core);
    expect(await runCli(['config', 'show', '--json'], showRun.dependencies)).toBe(0);
    expect(JSON.parse(showRun.stdout[0]!)).toEqual({ app: { port: 3000, log_level: 'info' } });
    expect(showRun.stderr).toEqual([]);

    const getRun = harness(core);
    expect(await runCli(['config', 'get', 'protocols.sing_box_configs', '--json'], getRun.dependencies)).toBe(0);
    expect(getRun.stdout).toEqual(['["one","two"]']);

    const setRun = harness(core);
    expect(await runCli(['config', 'set', 'app.port', '4321'], setRun.dependencies)).toBe(0);
    expect(setConfigValue).toHaveBeenCalledWith('app.port', 4321);
    expect(setRun.stdout).toEqual(['app.port 已保存，需要重启 Dashboard 生效']);

    const validRun = harness(core);
    const readTextFile = vi.fn(async () => 'app:\n  port: 3000\n');
    expect(await runCli(['config', 'validate', '--file', '/tmp/config.yaml', '--json'], { ...validRun.dependencies, readTextFile })).toBe(0);
    expect(readTextFile).toHaveBeenCalledWith('/tmp/config.yaml');
    expect(validateConfig).toHaveBeenLastCalledWith('app:\n  port: 3000\n');
    expect(validRun.stdout).toEqual(['{"valid":true,"issues":[]}']);

    const invalidRun = harness(core);
    expect(await runCli(['config', 'validate', '--file', '/tmp/broken.yaml'], {
      ...invalidRun.dependencies, readTextFile: vi.fn(async () => 'broken: true'),
    })).toBe(1);
    expect(invalidRun.stdout[0]).toContain('配置无效');
    expect(invalidRun.stderr).toEqual([]);
  });

  it('maps invalid CLI syntax to 2 and core/config failures to 1', async () => {
    const badSyntax = harness(createCore());
    expect(await runCli(['logs', '--lines', 'NaN'], badSyntax.dependencies)).toBe(2);
    expect(badSyntax.createCore).not.toHaveBeenCalled();
    expect(badSyntax.stderr[0]).toContain('Run "miobridge --help"');

    const missingField = harness(createCore());
    expect(await runCli(['config', 'get', 'missing.field'], missingField.dependencies)).toBe(1);
    expect(missingField.stderr).toEqual(['Error: 配置字段不存在: missing.field']);

    const rejectedSet = harness(createCore({ setConfigValue: vi.fn(async () => { throw new Error('不支持的配置字段'); }) }));
    expect(await runCli(['config', 'set', 'unknown.field', 'true'], rejectedSet.dependencies)).toBe(1);
  });

  it('reads local logs with defaults, filters, and a single follow stream', async () => {
    const getLocalLogs = vi.fn(async () => ({
      entries: [
        { file: 'control.log', lineNumber: 1, content: 'INFO ready', level: 'info' },
        { file: 'control.log', lineNumber: 2, content: 'ERROR failed', level: 'error' },
      ],
      files: ['control.log'], updatedAt: '2026-01-01T00:00:00.000Z',
    }));
    const followLocalLogs = vi.fn(async function* () {
      yield { file: 'control.log', lineNumber: 3, content: 'INFO follow', level: 'info' };
    });
    const core = createCore({ getLocalLogs, followLocalLogs });

    const regular = harness(core);
    expect(await runCli(['logs', '--level', 'error'], regular.dependencies)).toBe(0);
    expect(getLocalLogs).toHaveBeenCalledWith({ lines: 200, level: 'error' });
    expect(regular.stdout).toEqual(['INFO ready', 'ERROR failed']);

    const following = harness(core);
    expect(await runCli(['logs', '--lines', '10', '--follow'], following.dependencies)).toBe(0);
    expect(followLocalLogs).toHaveBeenCalledTimes(1);
    expect(followLocalLogs).toHaveBeenCalledWith({ lines: 10 });
    expect(following.stdout).toEqual(['INFO follow']);
  });

  it('keeps metrics JSON pure and formats the current snapshot in text mode', async () => {
    const json = harness(createCore());
    expect(await runCli(['metrics', '--json'], json.dependencies)).toBe(0);
    expect(json.stdout).toEqual([JSON.stringify(metrics)]);
    expect(json.stderr).toEqual([]);
    expect(JSON.parse(json.stdout[0]!)).toEqual(metrics);

    expect(formatMetrics(metrics)).toContain('Nodes: 2/3 online');
    expect(formatMetrics(metrics)).toContain('Clash: no');
    expect(formatMetrics(metrics)).toContain('Last generation: partial');
  });

  it('runs every local core command without Dashboard lifecycle adapters', async () => {
    const commands = [
      ['update', '--json'], ['status', '--json'], ['config', 'path'], ['config', 'show', '--json'],
      ['config', 'get', 'app.port', '--json'], ['config', 'validate', '--json'], ['logs'], ['metrics', '--json'],
    ] as const;
    for (const command of commands) {
      const run = harness(createCore({ getConfigValue: vi.fn(() => 3000) }));
      expect(await runCli(command, run.dependencies)).toBe(0);
      expect(run.stderr).toEqual([]);
    }
  });
});
