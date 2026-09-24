import { describe, expect, it } from 'vitest';
import { agentRelease, SshDeploymentService } from '../../src/dashboard/server/sshDeployment.js';
import { startAgent } from '../../src/dashboard/server/ssh/agent.js';
import { SshTransport } from '../../src/dashboard/server/ssh/transport.js';
import type { DeploymentConnection, SshTarget } from '../../src/dashboard/server/ssh/types.js';
import type { NodeCoreComposition } from '../../src/composition.js';
import { CLI_VERSION } from '../../src/command.js';
import { MioBridgeCore, type NodeConfig } from '@miobridge/core';

describe('Agent release distribution', () => {
  it('maps remote architectures to versioned release artifacts', () => {
    expect(agentRelease('1.0.0', 'x64', {})).toEqual({
      artifact: 'miobridge-agent-1.0.0-linux-x64.gz',
      baseUrl: 'https://github.com/imal1/MioBridge/releases/download/v1.0.0',
    });
    expect(agentRelease('1.0.0', 'arm64', {})).toEqual({
      artifact: 'miobridge-agent-1.0.0-linux-arm64.gz',
      baseUrl: 'https://github.com/imal1/MioBridge/releases/download/v1.0.0',
    });
  });

  it('uses the configured repository or release mirror', () => {
    expect(agentRelease('1.2.3', 'x64', { MIOBRIDGE_REPOSITORY: 'owner/repo' }).baseUrl)
      .toBe('https://github.com/owner/repo/releases/download/v1.2.3');
    expect(agentRelease('1.2.3', 'x64', { MIOBRIDGE_RELEASE_BASE_URL: 'https://mirror.example/v1.2.3' }).baseUrl)
      .toBe('https://mirror.example/v1.2.3');
  });

  it('enables and verifies user lingering before starting the Agent', async () => {
    const commands: string[] = [];
    let lingerChecks = 0;
    const ssh: DeploymentConnection = {
      async run(command) {
        commands.push(command);
        if (command.startsWith('test -x')) return { stdout: '', stderr: '', code: 1 };
        if (command === 'id -un') return { stdout: 'root\n', stderr: '', code: 0 };
        if (command.startsWith("loginctl show-user 'root'")) {
          lingerChecks += 1;
          return { stdout: lingerChecks === 1 ? 'no\n' : 'yes\n', stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 0 };
      },
      end() {},
    };
    const target: SshTarget = {
      nodeId: 'remote', nodeName: 'Remote', secret: 'secret', agentPort: 3001, kernels: [],
      ssh: { host: 'remote.example', user: 'root', port: 22, authMethod: 'password', password: 'secret', hostKey: '' },
    };

    await startAgent(new SshTransport(), ssh, target);

    expect(commands).toContain("loginctl enable-linger 'root'");
    expect(lingerChecks).toBe(2);
    expect(commands.some(command => command.includes("'enable' '--now' 'miobridge-agent.service'"))).toBe(true);
  });
});

describe('local deployment transport', () => {
  it('preflights the persisted local node without SSH credentials', async () => {
    const commands: string[] = [];
    const composition = {
      repository: { list: async () => [{
        id: 'local', name: '本机节点', host: '127.0.0.1', secret: 'secret', location: '本机', enabled: true,
        kernels: [{ type: 'sing-box' }], agent: { deployed: true, version: '1.2.0', status: 'running', lastDeploy: '', port: 3001 },
      }] },
      core: { createAgentAcceptance: MioBridgeCore.prototype.createAgentAcceptance, state: { get: async () => null } },
    } as unknown as NodeCoreComposition;
    const service = new SshDeploymentService(composition, { runLocal: async command => {
      commands.push(command);
      if (command === 'uname -s') return { stdout: 'Linux\n', stderr: '', code: 0 };
      if (command === 'uname -m') return { stdout: 'x86_64\n', stderr: '', code: 0 };
      if (command === 'id -un') return { stdout: 'root\n', stderr: '', code: 0 };
      if (command.startsWith("loginctl show-user 'root'")) return { stdout: 'yes\n', stderr: '', code: 0 };
      if (command.startsWith('df -Pk')) return { stdout: '512000\n', stderr: '', code: 0 };
      if (command === 'command -v systemctl') return { stdout: '/usr/bin/systemctl\n', stderr: '', code: 0 };
      if (command === 'command -v curl || command -v wget') return { stdout: '/usr/bin/curl\n', stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    } });
    const result = await service.preflight({ nodeId: 'local' });
    expect(result.architecture).toBe('x86_64');
    expect(result.checks.every(check => check.ok)).toBe(true);
    expect(result.checks.find(check => check.key === 'ssh')?.label).toBe('本机执行');
    expect(commands).toContain('uname -s');
    expect(commands.some(command => command.includes('sudo'))).toBe(false);
  });

  it('deploys only the user Agent and never installs a missing configured kernel', async () => {
    const commands: string[] = [];
    let node = {
      id: 'local', name: '本机节点', host: '127.0.0.1', secret: 'secret', location: '本机', enabled: true,
      kernels: [{ type: 'sing-box' as const }],
      agent: { deployed: false, version: '', status: 'not_deployed' as const, lastDeploy: '', port: 3001 },
    };
    const composition = {
      repository: {
        list: async () => [node],
        update: async (_id: string, update: (current: typeof node) => typeof node) => {
          node = update(node);
          return node;
        },
      },
      core: { createAgentAcceptance: MioBridgeCore.prototype.createAgentAcceptance, state: { get: async () => null } },
    } as unknown as NodeCoreComposition;
    const service = new SshDeploymentService(composition, { fetch: (async () => Response.json({ status: 'healthy', version: CLI_VERSION })) as typeof fetch, acceptance: { wait: async () => {} }, runLocal: async command => {
      commands.push(command);
      if (command === 'uname -m') return { stdout: 'x86_64\n', stderr: '', code: 0 };
      if (command === 'id -un') return { stdout: 'root\n', stderr: '', code: 0 };
      if (command.startsWith("loginctl show-user 'root'")) return { stdout: 'yes\n', stderr: '', code: 0 };
      if (command.includes("'/usr/local/bin/sing-box' 'help'")) return { stdout: '', stderr: 'missing', code: 1 };
      if (command.includes('/usr/local/bin/miobridge-agent') && command.startsWith('test -x')) return { stdout: '', stderr: '', code: 1 };
      return { stdout: '', stderr: '', code: 0 };
    } });

    await service.startDeployment('local');
    for (let attempt = 0; attempt < 50 && service.getProgress('local')?.status !== 'success'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    expect(service.getProgress('local')).toMatchObject({ status: 'success', step: 'done' });
    expect(commands.some(command => command.includes('raw.githubusercontent.com/233boy'))).toBe(false);
    expect(commands.some(command => command.includes('sudo'))).toBe(false);
    expect(commands.some(command => command.includes('$HOME/.local/bin/miobridge-agent'))).toBe(true);
    expect(commands.some(command => command.includes("loginctl show-user 'root'"))).toBe(true);
    expect(node.kernels).toEqual([]);
  });

  it('runs an installed 233boy wrapper directly and elevates only after an explicit permission error', async () => {
    const node = {
      id: 'local', name: '本机节点', host: '127.0.0.1', secret: 'secret', location: '本机', enabled: true,
      kernels: [{ type: 'sing-box' as const }],
    };
    const composition = {
      repository: { list: async () => [node] },
      core: { createAgentAcceptance: MioBridgeCore.prototype.createAgentAcceptance, state: { get: async () => null } },
    } as unknown as NodeCoreComposition;
    const directCommands: string[] = [];
    const direct = new SshDeploymentService(composition, { runLocal: async command => {
      directCommands.push(command);
      return { stdout: '', stderr: '', code: 0 };
    } });
    await direct.kernelAction('local', 'sing-box', 'restart');
    expect(directCommands).toEqual(["'/usr/local/bin/sing-box' 'restart'"]);

    const fallbackCommands: string[] = [];
    const fallback = new SshDeploymentService(composition, { runLocal: async command => {
      fallbackCommands.push(command);
      return command.startsWith('sudo -n')
        ? { stdout: '', stderr: '', code: 0 }
        : { stdout: '', stderr: 'permission denied', code: 1 };
    } });
    await fallback.kernelAction('local', 'sing-box', 'restart');
    expect(fallbackCommands[0]).toBe("'/usr/local/bin/sing-box' 'restart'");
    expect(fallbackCommands[1]).toContain('sudo -n bash -lc');
  });

  it('elevates a local installer based on the process uid even when a legacy profile says root', async () => {
    const node = {
      id: 'local', name: '本机节点', host: '127.0.0.1', secret: 'secret', location: '本机', enabled: true,
      kernels: [] as Array<{ type: 'sing-box' }>,
      ssh: { user: 'root', authMethod: 'password' as const, credentialRef: 'ssh-credentials/local', hostKey: '' },
    };
    const composition = {
      repository: { list: async () => [node] },
      core: { createAgentAcceptance: MioBridgeCore.prototype.createAgentAcceptance, state: { get: async (key: string) => key === 'ssh-credentials/local' ? 'local-password' : null } },
    } as unknown as NodeCoreComposition;
    const commands: string[] = [];
    const inputs: Array<string | undefined> = [];
    let detectionCount = 0;
    const service = new SshDeploymentService(composition, { runLocal: async (command, input) => {
      commands.push(command);
      inputs.push(input);
      if (command.includes("'/usr/local/bin/sing-box' 'help'")) {
        detectionCount += 1;
        return detectionCount === 1
          ? { stdout: '', stderr: 'missing', code: 1 }
          : { stdout: 'sing-box script v1.18', stderr: '', code: 0 };
      }
      if (command.startsWith("sudo -S -p ''")) return { stdout: 'success', stderr: '', code: 0 };
      return { stdout: '', stderr: '当前非 ROOT用户', code: 1 };
    } });

    await expect(service.installKernel('local', 'sing-box')).resolves.toMatchObject({ installed: true });
    expect(commands).toHaveLength(5);
    expect(commands[1]).toContain('raw.githubusercontent.com/233boy/sing-box/main/install.sh');
    expect(commands[1]).toContain('bash "$workdir/install.sh"');
    expect(commands[2]).toContain("sudo -S -p '' bash -lc");
    expect(commands[2]).toContain('raw.githubusercontent.com/233boy/sing-box/main/install.sh');
    expect(inputs[2]).toBe('local-password\n');
  });
});

describe('deployment survives its SSH session', () => {
  function fixture(health: () => Promise<Response>, startFailure = '') {
    const events: string[] = [];
    const commands: string[] = [];
    let node: NodeConfig = {
      id: 'remote', name: 'Remote', host: 'remote.example', secret: 'node-secret', kernels: [], location: '', enabled: true,
      ssh: { user: 'deploy', authMethod: 'password', credentialRef: 'ssh/remote', hostKey: 'known' },
      agent: { deployed: false, version: '', status: 'not_deployed', lastDeploy: '', port: 3001 },
    };
    const values = new Map<string, string>();
    const composition = {
      repository: { list: async () => [node], update: async (_id: string, update: (current: NodeConfig) => NodeConfig) => (node = update(node)) },
      core: { createAgentAcceptance: MioBridgeCore.prototype.createAgentAcceptance, state: {
        get: async (key: string) => key === 'ssh/remote' ? 'ssh-password' : values.get(key) ?? null,
        set: async (key: string, value: string) => { values.set(key, value); },
        listKeys: async (prefix: string) => [...values.keys()].filter(key => key.startsWith(prefix)),
      } },
    } as unknown as NodeCoreComposition;
    const service = new SshDeploymentService(composition, {
      acceptance: { wait: async () => { events.push('stabilized'); } },
      fetch: (async () => { events.push('health'); return health(); }) as typeof fetch,
      connect: async () => {
        events.push('connect');
        return {
          async run(command) {
            commands.push(command);
            if (command === 'uname -m') return { stdout: 'x86_64', stderr: '', code: 0 };
            if (command === 'id -un') return { stdout: 'deploy', stderr: '', code: 0 };
            if (command === 'printf %s "$HOME"') return { stdout: '/home/deploy', stderr: '', code: 0 };
            if (command.startsWith('loginctl show-user')) return { stdout: 'yes', stderr: '', code: 0 };
            if (command.startsWith('test -x /usr/local') || command.startsWith("test -x '/usr/local")) return { stdout: '', stderr: '', code: 1 };
            if (startFailure && command.includes("'enable' '--now'")) return { stdout: '', stderr: startFailure, code: 1 };
            return { stdout: '', stderr: '', code: 0 };
          },
          async end() { await Promise.resolve(); events.push('disconnect'); },
        };
      },
    });
    return { service, events, commands, node: () => node };
  }

  async function settled(service: SshDeploymentService) {
    for (let i = 0; i < 100; i++) {
      const status = service.getProgress('remote');
      if (status?.step === 'done' || status?.status === 'error') return status;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('deployment did not settle');
  }

  it('marks success only after the SSH session closes and public acceptance passes', async () => {
    const deployment = fixture(async () => Response.json({ status: 'healthy', version: CLI_VERSION }));
    await deployment.service.startDeployment('remote');
    expect(await settled(deployment.service)).toMatchObject({ step: 'done', status: 'success' });
    expect(deployment.events).toEqual(['connect', 'disconnect', 'stabilized', 'health']);
    expect(deployment.node().agent).toMatchObject({ status: 'running', version: CLI_VERSION });
    expect(deployment.commands.some(command => command.includes('curl -s -o /dev/null'))).toBe(false);
  });

  it('fails deployment on a version mismatch without reporting a running Agent', async () => {
    const deployment = fixture(async () => Response.json({ status: 'healthy', version: '0.0.1' }));
    await deployment.service.startDeployment('remote');
    expect(await settled(deployment.service)).toMatchObject({ status: 'error', errorCode: 'VERSION_MISMATCH', message: expect.stringContaining('0.0.1') });
    expect(deployment.node().agent?.status).toBe('error');
  });

  it('preserves startup diagnostics and never calls acceptance a success', async () => {
    const deployment = fixture(async () => Response.json({ status: 'healthy', version: CLI_VERSION }), 'invalid config node-secret password=ssh-password');
    await deployment.service.startDeployment('remote');
    const result = await settled(deployment.service);
    expect(result).toMatchObject({ status: 'error', errorCode: 'SERVICE_NOT_STARTED', message: expect.stringContaining('invalid config') });
    expect(JSON.stringify(result)).not.toMatch(/node-secret|ssh-password/);
    expect(deployment.node().agent?.status).toBe('error');
  });

  it.each(['install', 'upgrade', 'repair'])('keeps an Agent %s task running until independent acceptance finishes', async operation => {
    let releaseHealth!: (response: Response) => void;
    const deployment = fixture(() => new Promise<Response>(resolve => { releaseHealth = resolve; }));
    const { taskId } = await deployment.service.startComponentDeployment('remote', 'agent', operation);
    for (let i = 0; i < 100 && !deployment.events.includes('health'); i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(deployment.events).toContain('health');
    await new Promise(resolve => setTimeout(resolve, 550));
    expect(await deployment.service.getComponentDeployment(taskId)).toMatchObject({ status: 'running' });
    expect(deployment.service.getProgress('remote')).toMatchObject({ status: 'running', step: 'verify' });
    await expect(deployment.service.startDeployment('remote')).rejects.toThrow('节点正在部署或维护');
    await expect(deployment.service.agentAction('remote', 'stop')).rejects.toThrow('节点正在部署或维护');
    await expect(deployment.service.configureKernels('remote', [])).rejects.toThrow('节点正在部署或维护');
    releaseHealth(Response.json({ status: 'healthy', version: '0.0.1' }));
    for (let i = 0; i < 150 && (await deployment.service.getComponentDeployment(taskId))?.status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(await deployment.service.getComponentDeployment(taskId)).toMatchObject({ status: 'error', errorCode: 'VERSION_MISMATCH' });
  });
});
