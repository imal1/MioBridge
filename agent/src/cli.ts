import * as os from 'os';
import * as path from 'path';

export type AgentCommand =
  | { kind: 'version' }
  | { kind: 'check-config'; configPath: string }
  | { kind: 'serve'; configPath: string };

export class AgentArgumentError extends Error {}

export function defaultAgentConfigPath(
  environmentPath = process.env.MIOBRIDGE_AGENT_CONFIG,
  homeDirectory = os.homedir(),
): string {
  return environmentPath || path.join(homeDirectory, '.config', 'miobridge-agent', 'agent.yaml');
}

export function parseAgentArguments(
  argv: readonly string[],
  environmentPath = process.env.MIOBRIDGE_AGENT_CONFIG,
  homeDirectory = os.homedir(),
): AgentCommand {
  let configPath = defaultAgentConfigPath(environmentPath, homeDirectory);
  let command: 'serve' | 'version' | 'check-config' = 'serve';
  let explicitConfig = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case '--version':
      case '-v':
        if (command !== 'serve' || explicitConfig) {
          throw new AgentArgumentError(`${argument} cannot be combined with another command`);
        }
        command = 'version';
        break;
      case '--config': {
        if (command !== 'serve') throw new AgentArgumentError('--config cannot be combined with another command');
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) throw new AgentArgumentError('--config requires a path');
        configPath = value;
        explicitConfig = true;
        index += 1;
        break;
      }
      case '--check-config': {
        if (command !== 'serve' || explicitConfig) {
          throw new AgentArgumentError('--check-config cannot be combined with another command');
        }
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) throw new AgentArgumentError('--check-config requires a path');
        configPath = value;
        command = 'check-config';
        index += 1;
        break;
      }
      default:
        throw new AgentArgumentError(`unknown option: ${argument}`);
    }
  }

  if (command === 'version') return { kind: 'version' };
  if (command === 'check-config') return { kind: 'check-config', configPath };
  return { kind: 'serve', configPath };
}
