import { execFile } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { RuntimePaths } from '@miobridge/core';
import { dashboardManifestPath } from './foreground.js';
import { loadDashboardProvider } from './provider.js';

const execFileAsync = promisify(execFile);
export const DASHBOARD_UNIT_NAME = 'miobridge-dashboard.service';

export type DashboardDaemonState = 'running' | 'stopped' | 'unsupported' | 'broken';

export interface DashboardDaemonStatus {
  readonly state: DashboardDaemonState;
  readonly active: boolean;
  readonly enabled: boolean;
  readonly linger: boolean;
  readonly unitPath: string;
  readonly journalCommand: string;
  readonly message: string;
}

export interface CommandResult { readonly exitCode: number; readonly stdout: string; readonly stderr: string }

export interface SystemdAdapters {
  readonly platform: string;
  readonly username: string;
  readonly cliPath: string;
  readonly unitDirectory: string;
  readonly effectivePath: string;
  run(command: string, args: readonly string[]): Promise<CommandResult>;
  writeAtomic(path: string, content: string): Promise<void>;
  isPortAvailable(host: string, port: number): Promise<boolean>;
  confirmEnableLinger(username: string): Promise<boolean>;
}

export interface DashboardDaemonOptions { readonly host?: string; readonly port?: number }

function quote(value: string): string {
  if (value.includes('\n') || value.includes('\r') || value.includes('\0')) throw new Error('systemd value contains a control character');
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
}

export function renderDashboardUserUnit(input: {
  readonly cliPath: string;
  readonly baseDir: string;
  readonly configFile: string;
  readonly host: string;
  readonly port: number;
  readonly effectivePath: string;
}): string {
  return `[Unit]\nDescription=MioBridge dashboard\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=${quote(input.cliPath)} dashboard foreground\nRestart=on-failure\nRestartSec=5s\nTimeoutStopSec=30s\nNoNewPrivileges=true\nPrivateTmp=true\nEnvironment=${quote(`MIOBRIDGE_CONFIG_DIR=${input.baseDir}`)}\nEnvironment=${quote(`CONFIG_FILE=${input.configFile}`)}\nEnvironment=${quote(`HOSTNAME=${input.host}`)}\nEnvironment=${quote(`PORT=${input.port}`)}\nEnvironment=${quote(`PATH=${input.effectivePath}`)}\n\n[Install]\nWantedBy=default.target\n`;
}

function output(result: CommandResult): string { return `${result.stdout}\n${result.stderr}`.trim(); }

export class DashboardSystemdService {
  readonly unitPath: string;

  constructor(
    private readonly paths: Pick<RuntimePaths, 'baseDir' | 'configFile' | 'distDir'>,
    private readonly adapters: SystemdAdapters,
    private readonly options: DashboardDaemonOptions = {},
  ) {
    this.unitPath = join(adapters.unitDirectory, DASHBOARD_UNIT_NAME);
  }

  private journalCommand(): string { return `journalctl --user -u ${DASHBOARD_UNIT_NAME} -f`; }

  private async supported(): Promise<boolean> {
    if (this.adapters.platform !== 'linux') return false;
    const probe = await this.adapters.run('systemctl', ['--user', 'show-environment']);
    return probe.exitCode === 0;
  }

  private async lingerEnabled(): Promise<boolean> {
    const result = await this.adapters.run('loginctl', ['show-user', this.adapters.username, '--property=Linger', '--value']);
    return result.exitCode === 0 && result.stdout.trim() === 'yes';
  }

  private async legacyConflict(): Promise<boolean> {
    const result = await this.adapters.run('systemctl', ['show', 'miobridge.service', '--property=LoadState', '--value']);
    return result.exitCode === 0 && result.stdout.trim() !== 'not-found' && result.stdout.trim() !== '';
  }

  async status(): Promise<DashboardDaemonStatus> {
    const base = { unitPath: this.unitPath, journalCommand: this.journalCommand() };
    if (!(await this.supported())) return { ...base, state: 'unsupported', active: false, enabled: false, linger: false, message: 'systemd user manager is unavailable; daemon mode requires Linux with a working user systemd session.' };
    const linger = await this.lingerEnabled();
    const active = await this.adapters.run('systemctl', ['--user', 'is-active', DASHBOARD_UNIT_NAME]);
    const enabled = await this.adapters.run('systemctl', ['--user', 'is-enabled', DASHBOARD_UNIT_NAME]);
    if (active.exitCode === 0 && active.stdout.trim() === 'active') {
      return { ...base, state: 'running', active: true, enabled: enabled.exitCode === 0, linger, message: `Dashboard is running. Logs: ${this.journalCommand()}` };
    }
    if (active.stdout.trim() === 'failed') {
      return { ...base, state: 'broken', active: false, enabled: enabled.exitCode === 0, linger, message: `Dashboard service failed. Inspect provider logs with: ${this.journalCommand()}` };
    }
    const knownStopped = ['inactive', 'unknown'].includes(active.stdout.trim()) || /not[- ]found|could not be found/iu.test(output(active));
    if (!knownStopped) {
      return { ...base, state: 'broken', active: false, enabled: enabled.exitCode === 0, linger, message: `Could not inspect dashboard service: ${output(active) || 'systemctl failed'}. Logs: ${this.journalCommand()}` };
    }
    return { ...base, state: 'stopped', active: false, enabled: enabled.exitCode === 0, linger, message: `Dashboard is stopped. Logs: ${this.journalCommand()}` };
  }

  async start(): Promise<DashboardDaemonStatus> {
    const current = await this.status();
    if (current.state === 'unsupported' || current.state === 'broken') throw new Error(current.message);
    if (current.active) return current;
    if (await this.legacyConflict()) throw new Error('Legacy system service miobridge.service exists. Stop and disable it before starting the user dashboard service.');
    const host = this.options.host ?? '0.0.0.0';
    const port = this.options.port ?? 3000;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid dashboard port: ${port}`);
    if (!(await this.adapters.isPortAvailable(host, port))) throw new Error(`Dashboard port ${port} is already occupied. Stop the conflicting process or choose another port.`);
    await loadDashboardProvider(dashboardManifestPath(this.paths));
    if (!current.linger) {
      if (!(await this.adapters.confirmEnableLinger(this.adapters.username))) {
        throw new Error(`Lingering is disabled. Run "sudo loginctl enable-linger ${this.adapters.username}" to keep the dashboard running after logout.`);
      }
      const enabled = await this.adapters.run('loginctl', ['enable-linger', this.adapters.username]);
      if (enabled.exitCode !== 0) throw new Error(`Could not enable lingering. Run "sudo loginctl enable-linger ${this.adapters.username}" manually. ${output(enabled)}`.trim());
    }
    await this.adapters.writeAtomic(this.unitPath, renderDashboardUserUnit({ cliPath: this.adapters.cliPath, baseDir: this.paths.baseDir, configFile: this.paths.configFile, host, port, effectivePath: this.adapters.effectivePath }));
    for (const args of [['--user', 'daemon-reload'], ['--user', 'enable', '--now', DASHBOARD_UNIT_NAME]] as const) {
      const result = await this.adapters.run('systemctl', args);
      if (result.exitCode !== 0) throw new Error(`systemctl ${args.slice(1).join(' ')} failed: ${output(result) || 'unknown error'}`);
    }
    const result = await this.status();
    if (!result.active) throw new Error(`Dashboard provider failed to start. Inspect logs with: ${this.journalCommand()}`);
    return result;
  }

  async stop(): Promise<DashboardDaemonStatus> {
    const current = await this.status();
    if (current.state === 'unsupported') throw new Error(current.message);
    if (!current.active && !current.enabled) return current;
    const result = await this.adapters.run('systemctl', ['--user', 'disable', '--now', DASHBOARD_UNIT_NAME]);
    if (result.exitCode !== 0 && !/not loaded|does not exist|not found/iu.test(output(result))) throw new Error(`Could not stop dashboard: ${output(result)}`);
    return this.status();
  }
}

export function createNodeSystemdAdapters(options: { readonly env?: NodeJS.ProcessEnv; readonly input?: NodeJS.ReadStream; readonly output?: NodeJS.WriteStream } = {}): SystemdAdapters {
  const env = options.env ?? process.env;
  const home = env.HOME ?? homedir();
  return {
    platform: process.platform,
    username: env.USER ?? userInfo().username,
    cliPath: process.execPath,
    unitDirectory: join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'systemd', 'user'),
    effectivePath: env.PATH ?? '',
    async run(command, args) {
      try { const result = await execFileAsync(command, [...args], { env }); return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }; }
      catch (error) { const value = error as Error & { code?: number; stdout?: string; stderr?: string }; return { exitCode: typeof value.code === 'number' ? value.code : 1, stdout: value.stdout ?? '', stderr: value.stderr ?? value.message }; }
    },
    async writeAtomic(path, content) {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.tmp-${process.pid}`;
      await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, path);
    },
    isPortAvailable(host, port) {
      return new Promise(resolve => {
        const server = createServer();
        server.once('error', () => resolve(false));
        server.listen(port, host, () => server.close(() => resolve(true)));
      });
    },
    async confirmEnableLinger(username) {
      const input = options.input ?? process.stdin;
      const output = options.output ?? process.stdout;
      if (!input.isTTY) return false;
      output.write(`Enable systemd lingering for ${username} to survive logout? [y/N] `);
      input.setEncoding('utf8');
      return new Promise(resolve => input.once('data', value => resolve(String(value).trim().toLowerCase() === 'y' || String(value).trim().toLowerCase() === 'yes')));
    },
  };
}
