import type {
  ConfigApplyResult, ConfigValidationResult, FullConfig, LocalLogEntry, LocalLogQuery,
  LocalLogResult, MetricsSnapshot, StatusInfo, UpdateResult,
} from '@miobridge/core';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { formatSetupStatus, type DependencySetupService } from './setup/service.js';
import { formatDashboardDaemonStatus, type DashboardDaemonAction } from './dashboard/commands.js';
import type { DashboardDaemonStatus } from './dashboard/systemd.js';

export const CLI_VERSION = process.env.MIOBRIDGE_BUILD_VERSION ?? '1.2.0';

export interface CliCore {
  updateSubscription(): Promise<UpdateResult>;
  getStatus(): Promise<StatusInfo>;
  getConfigPath(): string;
  getEffectiveConfig(): FullConfig;
  getConfigValue(path: string): unknown;
  setConfigValue(path: string, value: unknown): Promise<ConfigApplyResult>;
  validateConfig(source?: string): ConfigValidationResult;
  getLocalLogs(options?: LocalLogQuery): Promise<LocalLogResult>;
  followLocalLogs(options?: LocalLogQuery): AsyncIterable<LocalLogEntry>;
  getMetricsSnapshot(): Promise<MetricsSnapshot>;
}

export interface CliOutput {
  stdout(message: string): void;
  stderr(message: string): void;
}

export interface CliDependencies {
  readonly createCore: () => CliCore;
  readonly output: CliOutput;
  readonly version?: string;
  readonly readTextFile?: (path: string) => Promise<string>;
  readonly signal?: AbortSignal;
  readonly setup?: Pick<DependencySetupService, 'run'>;
  readonly maintenance?: {
    upgrade(): Promise<string>;
    uninstall(purge: boolean): Promise<string>;
  };
  readonly dashboard?: {
    foreground(): Promise<{ readonly exitCode: number; readonly healthUrl: string }>;
    daemon?(action: DashboardDaemonAction): Promise<DashboardDaemonStatus>;
  };
}

type ParsedCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'update'; readonly json: boolean }
  | { readonly kind: 'setup'; readonly assumeYes: boolean }
  | { readonly kind: 'upgrade' }
  | { readonly kind: 'uninstall'; readonly purge: boolean }
  | { readonly kind: 'dashboard-foreground' }
  | { readonly kind: 'dashboard-daemon'; readonly action: DashboardDaemonAction; readonly json: boolean }
  | { readonly kind: 'status'; readonly json: boolean }
  | { readonly kind: 'config-path' }
  | { readonly kind: 'config-show'; readonly json: boolean }
  | { readonly kind: 'config-get'; readonly path: string; readonly json: boolean }
  | { readonly kind: 'config-set'; readonly path: string; readonly value: unknown }
  | { readonly kind: 'config-validate'; readonly file?: string; readonly json: boolean }
  | { readonly kind: 'logs'; readonly lines: number; readonly level?: string; readonly follow: boolean }
  | { readonly kind: 'metrics'; readonly json: boolean };

export const helpText = `MioBridge ${CLI_VERSION}

Usage: miobridge <command> [options]

Commands:
  setup [--yes]   Discover and install managed dependencies
  upgrade         Upgrade this CLI to the latest verified release
  uninstall [--purge]
                  Remove this CLI; --purge also removes configuration and data
  update [--json] Generate subscription artifacts
  status [--json] Show headless runtime status
  config path     Show the local runtime configuration path
  config show [--json]
                  Show the effective local configuration
  config get <field-path> [--json]
                  Read one configuration field
  config set <field-path> <value>
                  Set one configuration field using a YAML value
  config validate [--file <config.yaml>] [--json]
                  Validate the active or selected configuration
  logs [--lines N] [--level LEVEL] [--follow]
                  Read local control-plane logs
  metrics [--json]
                  Show the current local metrics snapshot
  dashboard foreground
                  Run the installed dashboard in the foreground
  dashboard start Start the persistent user dashboard service
  dashboard stop  Stop the persistent user dashboard service
  dashboard status [--json]
                  Show the persistent user dashboard service status

Options:
  -h, --help      Show help
  -v, --version   Show version`;

export function parseCommand(args: readonly string[]): ParsedCommand {
  if (args.length === 0 || args[0] === 'help' || args[0] === '-h' || args[0] === '--help') {
    if (args.length > 1) throw new Error(`Unexpected argument: ${args[1]}`);
    return { kind: 'help' };
  }
  if (args[0] === '-v' || args[0] === '--version' || args[0] === 'version') {
    if (args.length > 1) throw new Error(`Unexpected argument: ${args[1]}`);
    return { kind: 'version' };
  }
  if (args[0] === 'update') {
    if (args.length === 1) return { kind: 'update', json: false };
    if (args.length === 2 && args[1] === '--json') return { kind: 'update', json: true };
    throw new Error(`Unexpected argument: ${args[1]}`);
  }
  if (args[0] === 'setup') {
    if (args.length === 1) return { kind: 'setup', assumeYes: false };
    if (args.length === 2 && (args[1] === '--yes' || args[1] === '-y')) return { kind: 'setup', assumeYes: true };
    throw new Error(`Unexpected argument: ${args[1]}`);
  }
  if (args[0] === 'upgrade') {
    if (args.length > 1) throw new Error(`Unexpected argument: ${args[1]}`);
    return { kind: 'upgrade' };
  }
  if (args[0] === 'uninstall') {
    if (args.length === 1) return { kind: 'uninstall', purge: false };
    if (args.length === 2 && args[1] === '--purge') return { kind: 'uninstall', purge: true };
    throw new Error(`Unexpected argument: ${args[1]}`);
  }
  if (args[0] === 'status') {
    if (args.length === 1) return { kind: 'status', json: false };
    if (args.length === 2 && args[1] === '--json') return { kind: 'status', json: true };
    throw new Error(`Unexpected argument: ${args[1]}`);
  }
  if (args[0] === 'metrics') {
    if (args.length === 1) return { kind: 'metrics', json: false };
    if (args.length === 2 && args[1] === '--json') return { kind: 'metrics', json: true };
    throw new Error(`Unexpected argument: ${args[1]}`);
  }
  if (args[0] === 'config') return parseConfigCommand(args.slice(1));
  if (args[0] === 'logs') return parseLogsCommand(args.slice(1));
  if (args[0] === 'dashboard') {
    if (args.length === 2 && args[1] === 'foreground') return { kind: 'dashboard-foreground' };
    if (args[1] === 'start' || args[1] === 'stop') {
      if (args.length === 2) return { kind: 'dashboard-daemon', action: args[1], json: false };
      throw new Error(`Unexpected argument: ${args[2]}`);
    }
    if (args[1] === 'status') {
      if (args.length === 2) return { kind: 'dashboard-daemon', action: 'status', json: false };
      if (args.length === 3 && args[2] === '--json') return { kind: 'dashboard-daemon', action: 'status', json: true };
      throw new Error(`Unexpected argument: ${args[2]}`);
    }
    throw new Error(args.length === 1 ? 'Missing dashboard action' : `Unknown dashboard action: ${args[1]}`);
  }
  throw new Error(`Unknown command: ${args[0]}`);
}

function parseConfigCommand(args: readonly string[]): ParsedCommand {
  const action = args[0];
  if (action === 'path' && args.length === 1) return { kind: 'config-path' };
  if (action === 'show') {
    if (args.length === 1) return { kind: 'config-show', json: false };
    if (args.length === 2 && args[1] === '--json') return { kind: 'config-show', json: true };
  }
  if (action === 'get' && isOptionValue(args[1])) {
    if (args.length === 2) return { kind: 'config-get', path: args[1], json: false };
    if (args.length === 3 && args[2] === '--json') return { kind: 'config-get', path: args[1], json: true };
  }
  if (action === 'set' && isOptionValue(args[1]) && typeof args[2] === 'string' && args.length === 3) {
    return { kind: 'config-set', path: args[1], value: parseYaml(args[2]) as unknown };
  }
  if (action === 'validate') {
    let file: string | undefined;
    let json = false;
    for (let index = 1; index < args.length; index += 1) {
      if (args[index] === '--json' && !json) json = true;
      else if (args[index] === '--file' && file === undefined && isOptionValue(args[index + 1])) file = args[++index];
      else throw new Error(`Unexpected argument: ${args[index]}`);
    }
    return { kind: 'config-validate', ...(file ? { file } : {}), json };
  }
  throw new Error(action ? `Unknown config action: ${action}` : 'Missing config action');
}

function parseLogsCommand(args: readonly string[]): ParsedCommand {
  let lines = 200;
  let level: string | undefined;
  let follow = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--follow') follow = true;
    else if (args[index] === '--lines' && isOptionValue(args[index + 1])) {
      lines = Number(args[++index]);
      if (!Number.isInteger(lines) || lines < 1 || lines > 10000) throw new Error('--lines must be an integer from 1 to 10000');
    } else if (args[index] === '--level' && isOptionValue(args[index + 1])) level = args[++index];
    else throw new Error(`Unexpected argument: ${args[index]}`);
  }
  return { kind: 'logs', lines, ...(level ? { level } : {}), follow };
}

function isOptionValue(value: string | undefined): value is string {
  return typeof value === 'string' && !value.startsWith('--');
}

function formatBoolean(value: boolean): string {
  return value ? 'yes' : 'no';
}

export function formatStatus(status: StatusInfo): string {
  const lines = [
    `MioBridge ${status.version}`,
    `Subscription: ${formatBoolean(status.subscriptionExists)}`,
    `Raw sources: ${formatBoolean(status.rawExists)}`,
    `Clash config: ${formatBoolean(status.clashExists)}`,
    `Mihomo: ${status.mihomoAvailable ? `available (${status.mihomoVersion ?? 'unknown'})` : 'unavailable'}`,
    `Nodes: ${status.nodesCount ?? 0}`,
    `Uptime: ${status.uptime}s`,
  ];
  if (status.subscriptionLastUpdated) lines.push(`Last update: ${status.subscriptionLastUpdated}`);
  return lines.join('\n');
}

export function formatMetrics(metrics: MetricsSnapshot): string {
  const artifact = (name: string, value: { exists: boolean; ageSeconds?: number }) =>
    `${name}: ${value.exists ? `yes${value.ageSeconds === undefined ? '' : ` (${value.ageSeconds}s old)`}` : 'no'}`;
  return [
    `MioBridge ${metrics.version}`,
    `Uptime: ${metrics.uptime}s`,
    `Nodes: ${metrics.onlineNodes}/${metrics.enabledNodes} online`,
    `Sources: ${metrics.sources}`,
    `Proxies: ${metrics.proxies}`,
    `Mihomo: ${metrics.mihomoAvailable ? 'available' : 'unavailable'}`,
    artifact('Raw', metrics.artifacts.raw),
    artifact('Subscription', metrics.artifacts.subscription),
    artifact('Clash', metrics.artifacts.clash),
    ...(metrics.lastGeneration ? [
      `Last generation: ${metrics.lastGeneration.status} at ${metrics.lastGeneration.timestamp}${metrics.lastGeneration.durationMs === undefined ? '' : ` (${metrics.lastGeneration.durationMs}ms)`}`,
    ] : []),
  ].join('\n');
}

export async function runCli(args: readonly string[], dependencies: CliDependencies): Promise<number> {
  let command: ParsedCommand;
  try {
    command = parseCommand(args);
  } catch (error) {
    dependencies.output.stderr(`Error: ${error instanceof Error ? error.message : String(error)}\nRun "miobridge --help" for usage.`);
    return 2;
  }

  if (command.kind === 'help') {
    dependencies.output.stdout(helpText.replace(CLI_VERSION, dependencies.version ?? CLI_VERSION));
    return 0;
  }
  if (command.kind === 'version') {
    dependencies.output.stdout(dependencies.version ?? CLI_VERSION);
    return 0;
  }

  try {
    if (command.kind === 'setup') {
      if (!dependencies.setup) throw new Error('Setup adapters are unavailable');
      dependencies.output.stdout(formatSetupStatus(await dependencies.setup.run({ assumeYes: command.assumeYes })));
      return 0;
    }
    if (command.kind === 'upgrade') {
      if (!dependencies.maintenance) throw new Error('CLI maintenance adapters are unavailable');
      dependencies.output.stdout(await dependencies.maintenance.upgrade());
      return 0;
    }
    if (command.kind === 'uninstall') {
      if (!dependencies.maintenance) throw new Error('CLI maintenance adapters are unavailable');
      dependencies.output.stdout(await dependencies.maintenance.uninstall(command.purge));
      return 0;
    }
    if (command.kind === 'dashboard-foreground') {
      if (!dependencies.dashboard) throw new Error('Dashboard lifecycle adapters are unavailable');
      const result = await dependencies.dashboard.foreground();
      if (result.exitCode !== 0) dependencies.output.stderr(`Dashboard exited with status ${result.exitCode}`);
      return result.exitCode === 0 ? 0 : 1;
    }
    if (command.kind === 'dashboard-daemon') {
      const daemon = dependencies.dashboard?.daemon;
      if (!daemon) throw new Error('Dashboard daemon adapters are unavailable');
      const result = await daemon(command.action);
      dependencies.output.stdout(command.json ? JSON.stringify(result) : formatDashboardDaemonStatus(result));
      return result.state === 'unsupported' || result.state === 'broken' ? 1 : 0;
    }
    const core = dependencies.createCore();
    if (command.kind === 'update') {
      const result = await core.updateSubscription();
      dependencies.output.stdout(command.json ? JSON.stringify(result) : `${result.message}\nNodes: ${result.nodesCount}\nClash generated: ${formatBoolean(result.clashGenerated)}\nBackup: ${result.backupCreated}`);
      return result.success && result.clashGenerated ? 0 : result.success ? 3 : 1;
    }
    if (command.kind === 'status') {
      const status = await core.getStatus();
      dependencies.output.stdout(command.json ? JSON.stringify(status) : formatStatus(status));
      return 0;
    }
    if (command.kind === 'config-path') dependencies.output.stdout(core.getConfigPath());
    else if (command.kind === 'config-show') {
      const config = core.getEffectiveConfig();
      dependencies.output.stdout(command.json ? JSON.stringify(config) : stringifyYaml(config).trimEnd());
    } else if (command.kind === 'config-get') {
      const value = core.getConfigValue(command.path);
      if (value === null || value === undefined) throw new Error(`配置字段不存在: ${command.path}`);
      dependencies.output.stdout(command.json ? JSON.stringify(value) : formatConfigValue(value));
    } else if (command.kind === 'config-set') {
      const result = await core.setConfigValue(command.path, command.value);
      dependencies.output.stdout(`${result.path} 已保存${result.restartRequired ? '，需要重启 Dashboard 生效' : '并生效'}`);
    } else if (command.kind === 'config-validate') {
      const source = command.file
        ? await (dependencies.readTextFile ? dependencies.readTextFile(command.file) : Promise.reject(new Error('File reader is unavailable')))
        : undefined;
      const validation = core.validateConfig(source);
      dependencies.output.stdout(command.json ? JSON.stringify(validation) : formatValidation(validation));
      return validation.valid ? 0 : 1;
    } else if (command.kind === 'logs') {
      const options = { lines: command.lines, ...(command.level ? { level: command.level } : {}), ...(dependencies.signal ? { signal: dependencies.signal } : {}) };
      if (command.follow) {
        for await (const entry of core.followLocalLogs(options)) dependencies.output.stdout(entry.content);
      } else {
        const result = await core.getLocalLogs(options);
        result.entries.forEach(entry => dependencies.output.stdout(entry.content));
      }
    } else if (command.kind === 'metrics') {
      const metrics = await core.getMetricsSnapshot();
      dependencies.output.stdout(command.json ? JSON.stringify(metrics) : formatMetrics(metrics));
    }
    return 0;
  } catch (error) {
    dependencies.output.stderr(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function formatConfigValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return stringifyYaml(value).trimEnd();
}

function formatValidation(result: ConfigValidationResult): string {
  if (result.valid) return '配置有效';
  return ['配置无效:', ...result.issues.map(issue => `- ${issue.path}: ${issue.message}`)].join('\n');
}
