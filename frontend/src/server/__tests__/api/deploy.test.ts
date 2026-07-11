import { describe, it, expect, vi } from 'vitest';
import type { NodeConfig } from '@/server/types';

describe('Deploy API endpoints', () => {
  it('resolves a stored private key into a transient deploy target', async () => {
    const { createDeployTarget } = await import('@/pages/api/cluster/deploy');
    const getNodePrivateKey = vi.fn().mockResolvedValue('private-key-content');
    const node: NodeConfig = {
      id: 'node-key', name: 'Key node', host: 'key.example.com', port: 3001,
      secret: 'secret', kernel: 'sing-box', location: 'test', enabled: true,
      ssh: {
        user: 'root', authMethod: 'privateKey', credentialRef: 'ssh-keys/node-key', hostKey: '',
      },
    };

    const target = await createDeployTarget(node, { getNodePrivateKey });

    expect(getNodePrivateKey).toHaveBeenCalledWith(node);
    expect(target.ssh.privateKey).toBe('private-key-content');
    expect(target.ssh).not.toHaveProperty('password');
  });

  it('passes only a password for password-authenticated nodes', async () => {
    const { createDeployTarget } = await import('@/pages/api/cluster/deploy');
    const getNodePrivateKey = vi.fn();
    const node: NodeConfig = {
      id: 'node-password', name: 'Password node', host: 'password.example.com', port: 3001,
      secret: 'secret', kernel: 'xray', location: 'test', enabled: true,
      ssh: {
        user: 'admin', authMethod: 'password', hostKey: '', password: 'login-password',
      },
    };

    const target = await createDeployTarget(node, { getNodePrivateKey });

    expect(getNodePrivateKey).not.toHaveBeenCalled();
    expect(target.ssh.password).toBe('login-password');
    expect(target.ssh).not.toHaveProperty('privateKey');
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
});
