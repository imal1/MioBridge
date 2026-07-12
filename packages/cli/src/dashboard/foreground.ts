import { spawn, type ChildProcess } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import type { RuntimePaths } from '@miobridge/core';
import { DASHBOARD_MANIFEST_NAME, loadDashboardProvider, renderProviderUrl, type LoadedDashboardProvider } from './provider.js';

export interface ForegroundOptions {
  readonly host?: string;
  readonly port?: number;
}

export interface DashboardRuntime {
  readonly effectivePath: string;
  readonly executables: Readonly<Record<string, string>>;
}

export interface DashboardProcess {
  readonly pid?: number;
  wait(): Promise<number>;
  signal(signal: NodeJS.Signals): void;
}

export interface ForegroundAdapters {
  readonly env: Readonly<Record<string, string | undefined>>;
  resolveExecutable(command: string): Promise<string | null>;
  spawn(command: string, args: readonly string[], options: { readonly cwd: string; readonly env: Readonly<Record<string, string>> }): DashboardProcess;
  onSignal(signal: NodeJS.Signals, listener: () => void): () => void;
}

export interface ForegroundResult {
  readonly exitCode: number;
  readonly healthUrl: string;
  readonly provider: LoadedDashboardProvider;
}

export function dashboardManifestPath(paths: Pick<RuntimePaths, 'distDir'>): string {
  return join(paths.distDir, 'dashboard', DASHBOARD_MANIFEST_NAME);
}

export class DashboardForegroundService {
  constructor(
    private readonly paths: Pick<RuntimePaths, 'baseDir' | 'configFile' | 'distDir'>,
    private readonly adapters: ForegroundAdapters,
    private readonly runtime: DashboardRuntime = { effectivePath: '', executables: {} },
  ) {}

  async run(options: ForegroundOptions = {}): Promise<ForegroundResult> {
    const host = options.host ?? '0.0.0.0';
    const port = options.port ?? 3000;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid dashboard port: ${port}`);
    const provider = await loadDashboardProvider(dashboardManifestPath(this.paths));
    const executable = this.runtime.executables[provider.manifest.executable]
      ?? await this.adapters.resolveExecutable(provider.manifest.executable);
    if (!executable) throw new Error(`Dashboard provider requires '${provider.manifest.executable}', but it is not executable or on PATH`);
    const names = provider.manifest.environment;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.adapters.env)) if (value !== undefined) env[key] = value;
    if (this.runtime.effectivePath) env.PATH = this.runtime.effectivePath;
    env.NODE_ENV = 'production';
    env[names.host] = host;
    env[names.port] = String(port);
    env[names.configDir] = this.paths.baseDir;
    env[names.configFile] = this.paths.configFile;
    const child = this.adapters.spawn(executable, [provider.entrypoint, ...provider.manifest.args], { cwd: provider.root, env });
    const removers = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map(signal => this.adapters.onSignal(signal, () => child.signal(signal)));
    try {
      return { exitCode: await child.wait(), healthUrl: renderProviderUrl(provider.manifest.healthUrl, host, port), provider };
    } finally {
      for (const remove of removers) remove();
    }
  }
}

async function executableFile(path: string): Promise<boolean> {
  try {
    const details = await stat(path);
    if (!details.isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch { return false; }
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.filter(Boolean))];
}

/** Resolve Bun once for foreground children and persistent dashboard units. */
export async function resolveDashboardRuntime(
  paths: Pick<RuntimePaths, 'managedBinDir' | 'pathDirectories'>,
  configuredBunPath: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<DashboardRuntime> {
  const configured = configuredBunPath
    ? [configuredBunPath, join(configuredBunPath, 'bun')]
    : [];
  const candidates = [...configured, join(paths.managedBinDir, 'bun'), ...paths.pathDirectories.map(directory => join(directory, 'bun'))];
  const executable = (await Promise.all(candidates.map(async candidate => (await executableFile(candidate)) ? candidate : undefined))).find(Boolean);
  const directories = uniquePaths([
    ...(executable ? [dirname(executable)] : []),
    ...(configuredBunPath ? [configuredBunPath, dirname(configuredBunPath)] : []),
    paths.managedBinDir,
    ...(env.PATH ?? '').split(delimiter),
  ]);
  return {
    effectivePath: directories.join(delimiter),
    executables: executable ? { bun: executable } : {},
  };
}

export function createNodeForegroundAdapters(env: NodeJS.ProcessEnv = process.env): ForegroundAdapters {
  return {
    env,
    async resolveExecutable(command) {
      for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
        const candidate = join(directory, command);
        try { await access(candidate, constants.X_OK); return candidate; } catch { /* continue */ }
      }
      return null;
    },
    spawn(command, args, options) {
      const child: ChildProcess = spawn(command, [...args], { cwd: options.cwd, env: options.env, stdio: 'inherit' });
      return {
        ...(child.pid === undefined ? {} : { pid: child.pid }),
        wait: () => new Promise<number>((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code, signal) => resolve(code ?? (signal ? 128 : 1)));
        }),
        signal: signal => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); },
      };
    },
    onSignal(signal, listener) {
      process.on(signal, listener);
      return () => process.off(signal, listener);
    },
  };
}
