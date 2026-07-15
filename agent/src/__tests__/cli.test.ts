import { describe, expect, test } from 'bun:test';
import { AgentArgumentError, parseAgentArguments } from '../cli';

describe('Agent command line', () => {
  test('uses the environment config when no CLI path is supplied', () => {
    expect(parseAgentArguments([], '/env/agent.yaml', '/home/test')).toEqual({
      kind: 'serve',
      configPath: '/env/agent.yaml',
    });
  });

  test('lets --config override MIOBRIDGE_AGENT_CONFIG', () => {
    expect(parseAgentArguments(['--config', '/cli/agent.yaml'], '/env/agent.yaml')).toEqual({
      kind: 'serve',
      configPath: '/cli/agent.yaml',
    });
  });

  test('parses version and check-config commands', () => {
    expect(parseAgentArguments(['--version'])).toEqual({ kind: 'version' });
    expect(parseAgentArguments(['--check-config', '/tmp/agent.yaml'])).toEqual({
      kind: 'check-config',
      configPath: '/tmp/agent.yaml',
    });
  });

  test.each([
    [['--config'], /requires a path/],
    [['--check-config'], /requires a path/],
    [['--unknown'], /unknown option/],
    [['--config', '/tmp/a', '--version'], /cannot be combined/],
    [['--config', '/tmp/a', '--check-config', '/tmp/b'], /cannot be combined/],
  ] as const)('rejects invalid arguments: %j', (argv, error) => {
    expect(() => parseAgentArguments(argv)).toThrow(AgentArgumentError);
    expect(() => parseAgentArguments(argv)).toThrow(error);
  });
});
