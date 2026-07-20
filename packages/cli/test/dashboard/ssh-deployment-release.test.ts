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
  });
});
