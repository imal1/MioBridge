import { describe, expect, it } from 'vitest';
import { agentRelease, SshDeploymentService } from '../../src/dashboard/server/sshDeployment.js';
import type { NodeCoreComposition } from '../../src/composition.js';

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
});

describe('local deployment transport', () => {
  it('preflights the persisted local node without SSH credentials', async () => {
    const commands: string[] = [];
    const composition = {
      repository: { list: async () => [{
        id: 'local', name: '本机节点', host: '127.0.0.1', secret: 'secret', location: '本机', enabled: true,
        kernels: [{ type: 'sing-box' }], agent: { deployed: true, version: '1.2.0', status: 'running', lastDeploy: '', port: 3001 },
      }] },
      core: { state: { get: async () => null } },
    } as unknown as NodeCoreComposition;
    const service = new SshDeploymentService(composition, { runLocal: async command => {
      commands.push(command);
      if (command === 'uname -s') return { stdout: 'Linux\n', stderr: '', code: 0 };
      if (command === 'uname -m') return { stdout: 'x86_64\n', stderr: '', code: 0 };
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
      core: { state: { get: async () => null } },
    } as unknown as NodeCoreComposition;
    const service = new SshDeploymentService(composition, { runLocal: async command => {
      commands.push(command);
      if (command === 'uname -m') return { stdout: 'x86_64\n', stderr: '', code: 0 };
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
    expect(node.kernels).toEqual([]);
  });

  it('runs an installed 233boy wrapper directly and elevates only after an explicit permission error', async () => {
    const node = {
      id: 'local', name: '本机节点', host: '127.0.0.1', secret: 'secret', location: '本机', enabled: true,
      kernels: [{ type: 'sing-box' as const }],
    };
    const composition = {
      repository: { list: async () => [node] },
      core: { state: { get: async () => null } },
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

  it('runs the 233boy installer directly and elevates its explicit non-root result', async () => {
    const node = {
      id: 'local', name: '本机节点', host: '127.0.0.1', secret: 'secret', location: '本机', enabled: true,
      kernels: [] as Array<{ type: 'sing-box' }>,
    };
    const composition = {
      repository: { list: async () => [node] },
      core: { state: { get: async () => null } },
    } as unknown as NodeCoreComposition;
    const commands: string[] = [];
    let detectionCount = 0;
    const service = new SshDeploymentService(composition, { runLocal: async command => {
      commands.push(command);
      if (command.includes("'/usr/local/bin/sing-box' 'help'")) {
        detectionCount += 1;
        return detectionCount === 1
          ? { stdout: '', stderr: 'missing', code: 1 }
          : { stdout: 'sing-box script v1.18', stderr: '', code: 0 };
      }
      if (command.startsWith('sudo -n')) return { stdout: 'success', stderr: '', code: 0 };
      return { stdout: '', stderr: '当前非 ROOT用户', code: 1 };
    } });

    await expect(service.installKernel('local', 'sing-box')).resolves.toMatchObject({ installed: true });
    expect(commands).toHaveLength(5);
    expect(commands[1]).toContain('raw.githubusercontent.com/233boy/sing-box/main/install.sh');
    expect(commands[1]).toContain('bash "$workdir/install.sh"');
    expect(commands[2]).toContain('sudo -n bash -lc');
    expect(commands[2]).toContain('raw.githubusercontent.com/233boy/sing-box/main/install.sh');
  });
});
