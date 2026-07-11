import { describe, it, expect, vi } from 'vitest';
import type { NodeConfig } from '@/server/types';

describe('Deploy API endpoints', () => {
  it('resolves a stored private key into a transient deploy target', async () => {
    const { createDeployTarget } = await import('@/pages/api/cluster/deploy');
    const getNodePrivateKey = vi.fn().mockResolvedValue('private-key-content');
    const node: NodeConfig = {
      id: 'node-key', name: 'Key node', host: 'key.example.com', port: 3001,
      secret: 'secret', kernels: [{ type: 'sing-box' }, { type: 'xray' }], location: 'test', enabled: true,
      ssh: {
        user: 'root', authMethod: 'privateKey', credentialRef: 'ssh-keys/node-key', hostKey: '',
      },
    };

    const target = await createDeployTarget(node, { getNodePrivateKey });

    expect(getNodePrivateKey).toHaveBeenCalledWith(node);
    expect(target.ssh.privateKey).toBe('private-key-content');
    expect(target.ssh).not.toHaveProperty('password');
    expect(target.kernels).toEqual(node.kernels);
    expect(target).not.toHaveProperty('kernel');
  });

  it('passes only a password for password-authenticated nodes', async () => {
    const { createDeployTarget } = await import('@/pages/api/cluster/deploy');
    const getNodePrivateKey = vi.fn();
    const node: NodeConfig = {
      id: 'node-password', name: 'Password node', host: 'password.example.com', port: 3001,
      secret: 'secret', kernels: [{ type: 'xray' }], location: 'test', enabled: true,
      ssh: {
        user: 'admin', authMethod: 'password', hostKey: '', password: 'login-password',
      },
    };

    const target = await createDeployTarget(node, { getNodePrivateKey });

    expect(getNodePrivateKey).not.toHaveBeenCalled();
    expect(target.ssh.password).toBe('login-password');
    expect(target.ssh).not.toHaveProperty('privateKey');
  });

  it('uses the deployment request kernels instead of the last committed kernels', async () => {
    const { createDeployTarget } = await import('@/pages/api/cluster/deploy');
    const node: NodeConfig = {
      id: 'node-override', name: 'Override', host: 'override.example.com', port: 3001,
      secret: 'secret', kernels: [{ type: 'sing-box' }], location: 'test', enabled: true,
      ssh: { user: 'root', authMethod: 'password', hostKey: '', password: 'password' },
    };

    const target = await createDeployTarget(node, { getNodePrivateKey: vi.fn() }, [{ type: 'xray' }]);

    expect(target.kernels).toEqual([{ type: 'xray' }]);
  });

  it('persists only monitored kernels and treats a partial deployment as running', async () => {
    const { persistDeployResult } = await import('@/pages/api/cluster/deploy');
    const completeDeploymentIfCurrent = vi.fn().mockResolvedValue(true);
    const node: NodeConfig = {
      id: 'node-partial', name: 'Partial', host: 'partial.example.com', port: 3001,
      secret: 'secret',
      kernels: [
        { type: 'sing-box', configPath: '/custom/sing-box.json' },
        { type: 'xray' },
        { type: 'v2ray' },
      ],
      location: 'test', enabled: true,
    };
    const result = {
      outcome: 'partial' as const,
      success: true,
      message: 'Agent 已部署，但 xray 安装失败',
      kernels: [
        { type: 'sing-box' as const, selected: true, installed: true, monitored: true, installedNow: false, defaultConfigPath: '/etc/sing-box/config.json' },
        { type: 'xray' as const, selected: true, installed: false, monitored: false, installedNow: false, defaultConfigPath: '/usr/local/etc/xray/config.json', error: 'failed' },
        { type: 'v2ray' as const, selected: true, installed: true, monitored: true, installedNow: true, defaultConfigPath: '/etc/v2ray/config.json' },
      ],
    };

    await persistDeployResult(node, node.kernels, 'deploy-partial', 3001, result, { completeDeploymentIfCurrent });

    expect(completeDeploymentIfCurrent).toHaveBeenCalledWith(
      'node-partial',
      'deploy-partial',
      expect.objectContaining({
        kernels: [
          { type: 'sing-box', configPath: '/custom/sing-box.json' },
          { type: 'v2ray' },
        ],
        agent: expect.objectContaining({ deployed: true, status: 'running', port: 3001 }),
      }),
    );
  });

  it('keeps committed kernels unchanged after a failed deployment', async () => {
    const { persistDeployResult } = await import('@/pages/api/cluster/deploy');
    const completeDeploymentIfCurrent = vi.fn().mockResolvedValue(true);
    const node = {
      id: 'node-failed', name: 'Failed', host: 'failed.example.com', port: 3001,
      secret: 'secret', kernels: [{ type: 'sing-box' as const }], location: 'test', enabled: true,
    };

    await persistDeployResult(node, [{ type: 'xray' }], 'deploy-failed', 3001, {
      outcome: 'error', success: false, message: 'failed', kernels: [],
    }, { completeDeploymentIfCurrent });

    expect(completeDeploymentIfCurrent).toHaveBeenCalledWith(
      'node-failed',
      'deploy-failed',
      expect.not.objectContaining({ kernels: expect.anything() }),
    );
  });

  it('deploy handler should be importable', async () => {
    const mod = await import('@/pages/api/cluster/deploy');
    expect(typeof mod.default).toBe('function');
  });

  it('deploy/progress handler should be importable', async () => {
    const mod = await import('@/pages/api/cluster/deploy/progress');
    expect(typeof mod.default).toBe('function');
  });

  it('agent/update handler should be importable', async () => {
    const mod = await import('@/pages/api/cluster/agent/update');
    expect(typeof mod.default).toBe('function');
  });

  it('agent/uninstall handler should be importable', async () => {
    const mod = await import('@/pages/api/cluster/agent/uninstall');
    expect(typeof mod.default).toBe('function');
  });

  it('agent/restart handler should be importable', async () => {
    const mod = await import('@/pages/api/cluster/agent/restart');
    expect(typeof mod.default).toBe('function');
  });

  it('agent/stop handler should be importable', async () => {
    const mod = await import('@/pages/api/cluster/agent/stop');
    expect(typeof mod.default).toBe('function');
  });

  it('agent/start handler should be importable', async () => {
    const mod = await import('@/pages/api/cluster/agent/start');
    expect(typeof mod.default).toBe('function');
  });

  it('kernel/install handler should be importable', async () => {
    const mod = await import('@/pages/api/cluster/kernel/install');
    expect(typeof mod.default).toBe('function');
  });

  it('kernel/uninstall handler should be importable', async () => {
    const mod = await import('@/pages/api/cluster/kernel/uninstall');
    expect(typeof mod.default).toBe('function');
  });

  it.each(['install', 'uninstall'])('rejects an unsupported kernel in the %s route', async (action) => {
    const handler = (await import(`@/pages/api/cluster/kernel/${action}`)).default;
    const res = {
      statusCode: 200, body: undefined as any,
      status(code: number) { this.statusCode = code; return this; },
      json(value: any) { this.body = value; return this; },
    };

    await handler({ method: 'POST', body: { nodeId: 'node', kernelType: 'clash' } } as any, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('不支持的内核类型');
  });
});
