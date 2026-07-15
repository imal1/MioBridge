import type { StatusInfo, UpdateResult } from '@miobridge/core';
import { formatSetupStatus, type DependencySetupService } from './setup/service.js';
import { formatDashboardDaemonStatus, type DashboardDaemonAction } from './dashboard/commands.js';
import type { DashboardDaemonStatus } from './dashboard/systemd.js';

export const CLI_VERSION = process.env.MIOBRIDGE_BUILD_VERSION ?? '1.0.0';

export interface CliCore {
  updateSubscription(): Promise<UpdateResult>;
  getStatus(): Promise<StatusInfo>;
}

export interface CliOutput {
  stdout(message: string): void;
  stderr(message: string): void;
}

export interface CliDependencies {
  readonly createCore: () => CliCore;
  readonly output: CliOutput;
  readonly version?: string;
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
  | { readonly kind: 'update' }
  | { readonly kind: 'setup'; readonly assumeYes: boolean }
  | { readonly kind: 'upgrade' }
  | { readonly kind: 'uninstall'; readonly purge: boolean }
  | { readonly kind: 'dashboard-foreground' }
  | { readonly kind: 'dashboard-daemon'; readonly action: DashboardDaemonAction; readonly json: boolean }
  | { readonly kind: 'status'; readonly json: boolean };

export const helpText = `MioBridge ${CLI_VERSION}

Usage: miobridge <command> [options]

Commands:
  setup [--yes]   Discover and install managed dependencies
  upgrade         Upgrade this CLI to the latest verified release
  uninstall [--purge]
                  Remove this CLI; --purge also removes configuration and data
  update          Generate subscription artifacts
  status [--json] Show headless runtime status
  dashboard foreground
                  Run the installed dashboard in the foreground
  dashboard start|stop|status [--json]
                  Manage the persistent user dashboard service

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
    if (args.length > 1) throw new Error(`Unexpected argument: ${args[1]}`);
    return { kind: 'update' };
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
  if (args[0] === 'dashboard') {
    if (args.length === 2 && args[1] === 'foreground') return { kind: 'dashboard-foreground' };
    if (args[1] === 'start' || args[1] === 'stop' || args[1] === 'status') {
      if (args.length === 2) return { kind: 'dashboard-daemon', action: args[1], json: false };
      if (args.length === 3 && args[2] === '--json') return { kind: 'dashboard-daemon', action: args[1], json: true };
      throw new Error(`Unexpected argument: ${args[2]}`);
    }
    throw new Error(args.length === 1 ? 'Missing dashboard action' : `Unknown dashboard action: ${args[1]}`);
  }
  throw new Error(`Unknown command: ${args[0]}`);
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
      return result.exitCode;
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
      dependencies.output.stdout(`${result.message}\nNodes: ${result.nodesCount}\nClash generated: ${formatBoolean(result.clashGenerated)}\nBackup: ${result.backupCreated}`);
    } else {
      const status = await core.getStatus();
      dependencies.output.stdout(command.json ? JSON.stringify(status) : formatStatus(status));
    }
    return 0;
  } catch (error) {
    dependencies.output.stderr(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
