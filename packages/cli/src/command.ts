import type { StatusInfo, UpdateResult } from '@miobridge/core';
import { formatSetupStatus, type DependencySetupService } from './setup/service.js';

export const CLI_VERSION = '0.1.0';

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
}

type ParsedCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'update' }
  | { readonly kind: 'setup' }
  | { readonly kind: 'status'; readonly json: boolean };

export const helpText = `MioBridge ${CLI_VERSION}

Usage: miobridge <command> [options]

Commands:
  setup           Discover and optionally install managed dependencies
  update          Generate subscription artifacts
  status [--json] Show headless runtime status

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
    if (args.length > 1) throw new Error(`Unexpected argument: ${args[1]}`);
    return { kind: 'setup' };
  }
  if (args[0] === 'status') {
    if (args.length === 1) return { kind: 'status', json: false };
    if (args.length === 2 && args[1] === '--json') return { kind: 'status', json: true };
    throw new Error(`Unexpected argument: ${args[1]}`);
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
      dependencies.output.stdout(formatSetupStatus(await dependencies.setup.run()));
      return 0;
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
