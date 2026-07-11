import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSshConnectOptions, DeployManager } from '../deployManager';

describe('DeployManager multi-kernel deployment', () => {
  let deployManager: DeployManager;

  beforeEach(() => {
    vi.restoreAllMocks();
    deployManager = DeployManager.getInstance();
  });

  describe('DeployManager.deployToNode', () => {
    it('builds password authentication without private-key or agent fallback', () => {
      const options = buildSshConnectOptions({
        nodeId: 'password-node', secret: 'secret', kernels: [{ type: 'sing-box' }],
        ssh: {
          host: '10.0.0.1', user: 'root', authMethod: 'password',
          hostKey: '', password: 'login-password',
        },
      });

      expect(options.password).toBe('login-password');
      expect(options).not.toHaveProperty('privateKey');
      expect(options).not.toHaveProperty('agent');
    });

    it('builds private-key authentication without password or agent fallback', () => {
      const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----';
      const options = buildSshConnectOptions({
        nodeId: 'key-node', secret: 'secret', kernels: [{ type: 'sing-box' }],
        ssh: {
          host: '10.0.0.2', user: 'root', authMethod: 'privateKey',
          hostKey: '', privateKey,
        },
      });

      expect(options.privateKey).toBe(privateKey);
      expect(options).not.toHaveProperty('password');
      expect(options).not.toHaveProperty('agent');
    });

    it('rejects a missing selected credential before connecting', () => {
      expect(() => buildSshConnectOptions({
        nodeId: 'missing-key', secret: 'secret', kernels: [{ type: 'sing-box' }],
        ssh: {
          host: '10.0.0.3', user: 'root', authMethod: 'privateKey', hostKey: '',
        },
      })).toThrow('SSH 私钥文件不可用');
    });

    it('detects all supported kernels in parallel over one SSH connection', async () => {
      const ssh = { end: vi.fn() };
      vi.spyOn(deployManager as any, 'connectSsh').mockResolvedValue(ssh);
      const pending: Array<() => void> = [];
      const exec = vi.spyOn(deployManager as any, 'execSsh').mockImplementation((_ssh, command) =>
        new Promise(resolve => pending.push(() => resolve({ stdout: `${command.split(' ')[0]} 1.2.3\n`, stderr: '', code: 0 }))),
      );

      const detectionPromise = deployManager.detectKernels({
        nodeId: 'detect', secret: '', kernels: [],
        ssh: { host: '10.0.0.1', user: 'root', authMethod: 'password', hostKey: '', password: 'pw' },
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(exec).toHaveBeenCalledTimes(3);
      expect(exec.mock.calls.map(call => call[1])).toEqual([
        'sing-box version 2>&1', 'xray version 2>&1', 'v2ray version 2>&1',
      ]);
      pending.forEach(resolve => resolve());
      const result = await detectionPromise;
      expect(result).toEqual([
        expect.objectContaining({ type: 'sing-box', installed: true, version: 'sing-box 1.2.3', defaultConfigPath: '/etc/sing-box/config.json' }),
        expect.objectContaining({ type: 'xray', installed: true, version: 'xray 1.2.3', defaultConfigPath: '/usr/local/etc/xray/config.json' }),
        expect.objectContaining({ type: 'v2ray', installed: true, version: 'v2ray 1.2.3', defaultConfigPath: '/etc/v2ray/config.json' }),
      ]);
      expect(ssh.end).toHaveBeenCalledOnce();
    });

    it('installs missing kernels sequentially in supported order and continues after one failure', async () => {
      const ssh = { end: vi.fn() };
      vi.spyOn(deployManager as any, 'connectSsh').mockResolvedValue(ssh);
      vi.spyOn(deployManager as any, 'ensureBun').mockResolvedValue(true);
      const active: string[] = [];
      const ensure = vi.spyOn(deployManager as any, 'ensureKernel').mockImplementation(async (_ssh, _target, config) => {
        expect(active).toEqual([]);
        active.push(config.type);
        await Promise.resolve();
        active.pop();
        if (config.type === 'xray') throw new Error('xray install failed');
        return { type: config.type, installed: true, version: `${config.type} 1.0`, defaultConfigPath: config.configPath || `/etc/${config.type}/config.json`, installedNow: config.type === 'v2ray' };
      });
      const upload = vi.spyOn(deployManager as any, 'uploadAgent').mockResolvedValue(undefined);
      vi.spyOn(deployManager as any, 'startAgent').mockResolvedValue(undefined);
      vi.spyOn(deployManager as any, 'verifyAgent').mockResolvedValue(undefined);

      const result = await deployManager.deployToNode({
        nodeId: 'multi', secret: 'secret',
        kernels: [{ type: 'v2ray' }, { type: 'xray' }, { type: 'sing-box' }],
        ssh: { host: '10.0.0.1', user: 'root', authMethod: 'password', hostKey: '', password: 'pw' },
      });

      expect(ensure.mock.calls.map(call => call[2].type)).toEqual(['sing-box', 'xray', 'v2ray']);
      expect(upload).toHaveBeenCalledWith(ssh, expect.anything(), expect.any(Function), [
        expect.objectContaining({ type: 'sing-box' }),
        expect.objectContaining({ type: 'v2ray' }),
      ]);
      expect(result.outcome).toBe('partial');
      expect(result.success).toBe(true);
      expect(result.kernels.find(item => item.type === 'xray')).toEqual(expect.objectContaining({ monitored: false, error: 'xray install failed' }));
      expect(ssh.end).toHaveBeenCalledOnce();
    });

    it('skips installed kernels and continues to the next install after a script failure', async () => {
      const ssh = { end: vi.fn() };
      vi.spyOn(deployManager as any, 'connectSsh').mockResolvedValue(ssh);
      vi.spyOn(deployManager as any, 'ensureBun').mockResolvedValue(true);
      const versionAttempts = new Map<string, number>();
      vi.spyOn(deployManager as any, 'execSsh').mockImplementation(async (_ssh, command: string) => {
        const type = command.split(' ')[0];
        const attempt = (versionAttempts.get(type) || 0) + 1;
        versionAttempts.set(type, attempt);
        if (type === 'sing-box' || (type === 'v2ray' && attempt === 2)) {
          return { stdout: `${type} 1.0\n`, stderr: '', code: 0 };
        }
        return { stdout: '', stderr: `${type}: command not found`, code: 127 };
      });
      const install = vi.spyOn(deployManager as any, 'execRoot').mockImplementation(async (_ssh, _target, command: string) => {
        if (command.includes('/233boy/Xray/')) return { stdout: '', stderr: 'xray failed', code: 1 };
        return { stdout: 'installed', stderr: '', code: 0 };
      });
      vi.spyOn(deployManager as any, 'uploadAgent').mockResolvedValue(undefined);
      vi.spyOn(deployManager as any, 'startAgent').mockResolvedValue(undefined);
      vi.spyOn(deployManager as any, 'verifyAgent').mockResolvedValue(undefined);

      const result = await deployManager.deployToNode({
        nodeId: 'real-ensure', secret: 'secret',
        kernels: [{ type: 'sing-box' }, { type: 'xray' }, { type: 'v2ray' }],
        ssh: { host: '10.0.0.1', user: 'root', authMethod: 'password', hostKey: '', password: 'pw' },
      });

      expect(install.mock.calls.map(call => call[2])).toEqual([
        expect.stringContaining('/233boy/Xray/'),
        expect.stringContaining('/233boy/v2ray/'),
      ]);
      expect(versionAttempts.get('sing-box')).toBe(1);
      expect(result.outcome).toBe('partial');
      expect(result.kernels.filter(item => item.monitored).map(item => item.type)).toEqual(['sing-box', 'v2ray']);
    });

    it('generates plural kernel YAML containing only successful kernels', () => {
      const yaml = deployManager.generateAgentYaml('node', 'node', 'secret', [
        { type: 'sing-box' },
        { type: 'v2ray' },
      ], 3001);

      expect(yaml).toContain('kernels:\n  - type: "sing-box"\n    configPath: "/etc/sing-box/config.json"');
      expect(yaml).toContain('  - type: "v2ray"\n    configPath: "/etc/v2ray/config.json"');
      expect(yaml).not.toContain('type: "xray"');
    });

    it('rejects unsafe kernel config paths before generating agent YAML', () => {
      expect(() => deployManager.generateAgentYaml('node', 'node', 'secret', [
        { type: 'xray', configPath: '/etc/xray/config.json\nYAML_EOF\ntouch /tmp/pwned' },
      ], 3001)).toThrow('内核配置路径无效: xray');
    });

    it('passes a non-root sudo password over SSH stdin instead of embedding it in the command', async () => {
      const ssh = {};
      const password = "dangerous ' password\nwith newline";
      const exec = vi.spyOn(deployManager as any, 'execSsh').mockResolvedValue({
        stdout: '', stderr: '', code: 0,
      });

      await (deployManager as any).execRoot(ssh, {
        nodeId: 'sudo-node', secret: 'secret', kernels: [{ type: 'sing-box' }],
        ssh: {
          host: '10.0.0.1', user: 'deploy', authMethod: 'password', hostKey: '', password,
        },
      }, 'systemctl daemon-reload');

      expect(exec).toHaveBeenCalledWith(
        ssh,
        expect.stringContaining("sudo -S -p '' bash -lc"),
        `${password}\n`,
      );
      expect(exec.mock.calls[0][1]).not.toContain(password);
    });

    it.each([
      ['agent config', '/etc/miobridge-agent/agent.yaml'],
      ['systemd unit', '/etc/systemd/system/miobridge-agent.service'],
    ])('returns an error and does not start when atomic %s installation fails', async (_name, failedPath) => {
      const ssh = { end: vi.fn() };
      vi.spyOn(deployManager as any, 'connectSsh').mockResolvedValue(ssh);
      vi.spyOn(deployManager as any, 'ensureBun').mockResolvedValue(true);
      vi.spyOn(deployManager as any, 'ensureKernel').mockResolvedValue({
        type: 'sing-box', installed: true, version: '1.0', installedNow: false,
        defaultConfigPath: '/etc/sing-box/config.json',
      });
      vi.spyOn(deployManager as any, 'sftpUploadAgent').mockResolvedValue(undefined);
      vi.spyOn(deployManager as any, 'buildAgentOnRemote').mockResolvedValue(undefined);
      const rootCommands: string[] = [];
      vi.spyOn(deployManager as any, 'execRoot').mockImplementation(async (_ssh, _target, command: string) => {
        rootCommands.push(command);
        return command.includes(failedPath)
          ? { stdout: '', stderr: 'write failed', code: 1 }
          : { stdout: '', stderr: '', code: 0 };
      });
      const start = vi.spyOn(deployManager as any, 'startAgent').mockResolvedValue(undefined);

      const result = await deployManager.deployToNode({
        nodeId: 'atomic-failure', secret: 'secret', kernels: [{ type: 'sing-box' }],
        ssh: { host: '10.0.0.1', user: 'root', authMethod: 'password', hostKey: '', password: 'pw' },
      });

      expect(result.outcome).toBe('error');
      expect(result.message).toContain('write failed');
      expect(start).not.toHaveBeenCalled();
      expect(rootCommands.some(command => command.includes(`cat > ${failedPath}`))).toBe(false);
    });

    it('installs dynamic config and unit content through same-directory temp files and atomic moves', async () => {
      const ssh = {};
      vi.spyOn(deployManager as any, 'sftpUploadAgent').mockResolvedValue(undefined);
      vi.spyOn(deployManager as any, 'buildAgentOnRemote').mockResolvedValue(undefined);
      const rootCommands: string[] = [];
      vi.spyOn(deployManager as any, 'execRoot').mockImplementation(async (_ssh, _target, command: string) => {
        rootCommands.push(command);
        return { stdout: '', stderr: '', code: 0 };
      });

      await (deployManager as any).uploadAgent(ssh, {
        nodeId: 'atomic-success', secret: 'secret', kernels: [{ type: 'sing-box' }],
        ssh: { host: '10.0.0.1', user: 'root', authMethod: 'password', hostKey: '', password: 'pw' },
      }, vi.fn(), [{ type: 'sing-box' }]);

      for (const targetPath of [
        '/etc/miobridge-agent/agent.yaml',
        '/etc/systemd/system/miobridge-agent.service',
      ]) {
        const command = rootCommands.find(item => item.includes(targetPath));
        expect(command).toBeDefined();
        expect(command).toMatch(/mktemp .*\.tmp\.XXXXXX/);
        expect(command).toContain('base64 -d');
        expect(command).toContain('chmod ');
        expect(command).toContain('mv -- "$tmp"');
        expect(command).toContain(targetPath);
        expect(command).not.toContain(`cat > ${targetPath}`);
      }
    });

    it('writes the real agent YAML with only kernels that passed deployment', async () => {
      const ssh = { end: vi.fn() };
      vi.spyOn(deployManager as any, 'connectSsh').mockResolvedValue(ssh);
      vi.spyOn(deployManager as any, 'ensureBun').mockResolvedValue(true);
      vi.spyOn(deployManager as any, 'ensureKernel').mockImplementation(async (_ssh, _target, config) => {
        if (config.type === 'xray') throw new Error('xray failed');
        return {
          type: config.type, installed: true, version: '1.0', installedNow: false,
          defaultConfigPath: config.type === 'sing-box' ? '/etc/sing-box/config.json' : '/etc/v2ray/config.json',
        };
      });
      vi.spyOn(deployManager as any, 'sftpUploadAgent').mockResolvedValue(undefined);
      vi.spyOn(deployManager as any, 'buildAgentOnRemote').mockResolvedValue(undefined);
      const rootCommands: string[] = [];
      vi.spyOn(deployManager as any, 'execRoot').mockImplementation(async (_ssh, _target, command: string) => {
        rootCommands.push(command);
        return { stdout: '', stderr: '', code: 0 };
      });
      vi.spyOn(deployManager as any, 'startAgent').mockResolvedValue(undefined);
      vi.spyOn(deployManager as any, 'verifyAgent').mockResolvedValue(undefined);

      await deployManager.deployToNode({
        nodeId: 'yaml-real', secret: 'secret',
        kernels: [{ type: 'sing-box' }, { type: 'xray' }, { type: 'v2ray' }],
        ssh: { host: '10.0.0.1', user: 'root', authMethod: 'password', hostKey: '', password: 'pw' },
      });

      const writeCommand = rootCommands.find(command => command.includes('/etc/miobridge-agent/agent.yaml'));
      expect(writeCommand).toBeDefined();
      const expectedYaml = deployManager.generateAgentYaml('yaml-real', 'yaml-real', 'secret', [
        { type: 'sing-box' }, { type: 'v2ray' },
      ], 3001);
      expect(writeCommand).toContain(Buffer.from(expectedYaml).toString('base64'));
      expect(writeCommand).not.toContain(Buffer.from('type: "xray"').toString('base64'));
    });

    it('does not upload the Agent when every selected kernel fails', async () => {
      const ssh = { end: vi.fn() };
      vi.spyOn(deployManager as any, 'connectSsh').mockResolvedValue(ssh);
      vi.spyOn(deployManager as any, 'ensureBun').mockResolvedValue(true);
      vi.spyOn(deployManager as any, 'ensureKernel').mockRejectedValue(new Error('install failed'));
      const upload = vi.spyOn(deployManager as any, 'uploadAgent').mockResolvedValue(undefined);

      const result = await deployManager.deployToNode({
        nodeId: 'none', secret: 'secret', kernels: [{ type: 'xray' }, { type: 'v2ray' }],
        ssh: { host: '10.0.0.1', user: 'root', authMethod: 'password', hostKey: '', password: 'pw' },
      });

      expect(result.outcome).toBe('error');
      expect(upload).not.toHaveBeenCalled();
      expect(ssh.end).toHaveBeenCalledOnce();
    });

    it.each(['upload', 'start', 'verify'] as const)(
      'returns an unmonitored error result and closes SSH when %s fails',
      async (failedStage) => {
        const ssh = { end: vi.fn() };
        vi.spyOn(deployManager as any, 'connectSsh').mockResolvedValue(ssh);
        vi.spyOn(deployManager as any, 'ensureBun').mockResolvedValue(true);
        vi.spyOn(deployManager as any, 'ensureKernel').mockResolvedValue({
          type: 'sing-box', installed: true, version: '1.0', installedNow: false,
          defaultConfigPath: '/etc/sing-box/config.json',
        });
        vi.spyOn(deployManager as any, 'uploadAgent')
          .mockImplementation(async () => { if (failedStage === 'upload') throw new Error('upload failed'); });
        vi.spyOn(deployManager as any, 'startAgent')
          .mockImplementation(async () => { if (failedStage === 'start') throw new Error('start failed'); });
        vi.spyOn(deployManager as any, 'verifyAgent')
          .mockImplementation(async () => { if (failedStage === 'verify') throw new Error('verify failed'); });

        const result = await deployManager.deployToNode({
          nodeId: failedStage, secret: 'secret', kernels: [{ type: 'sing-box' }],
          ssh: { host: '10.0.0.1', user: 'root', authMethod: 'password', hostKey: '', password: 'pw' },
        });

        expect(result.outcome).toBe('error');
        expect(result.kernels.find(item => item.type === 'sing-box')?.monitored).toBe(false);
        expect(ssh.end).toHaveBeenCalledOnce();
      },
    );
  });
});
