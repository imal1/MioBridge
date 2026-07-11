import { beforeEach, describe, expect, it, vi } from 'vitest';
import { utils as sshUtils } from 'ssh2';

const { writeNodeWithPrivateKey } = vi.hoisted(() => ({
  writeNodeWithPrivateKey: vi.fn(async (node) => ({ ...node, id: 'node-test' })),
}));

vi.mock('@/server/services/nodeManager', () => ({
  NodeManager: { getInstance: () => ({ writeNodeWithPrivateKey }) },
}));

import handler from '@/pages/api/cluster/nodes';

function mockRes() {
  return {
    _status: 200,
    _json: undefined as any,
    status(code: number) { this._status = code; return this; },
    json(value: any) { this._json = value; return this; },
  };
}

const baseBody = {
  name: 'Test node', host: 'node.example.com', kernel: 'sing-box',
  location: 'test', sshUser: 'root',
};

describe('POST /api/cluster/nodes SSH credentials', () => {
  beforeEach(() => writeNodeWithPrivateKey.mockClear());

  it('rejects password mode without a password', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: { ...baseBody, sshAuthMethod: 'password' } } as any, res as any);

    expect(res._status).toBe(400);
    expect(res._json.error).toContain('SSH 密码');
  });

  it('rejects credentials from both authentication methods', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: {
      ...baseBody, sshAuthMethod: 'privateKey', sshPassword: 'password', sshPrivateKey: 'key',
    } } as any, res as any);

    expect(res._status).toBe(400);
    expect(res._json.error).toContain('不能同时');
  });

  it('rejects a private key attached to password mode even without a password', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: {
      ...baseBody, sshAuthMethod: 'password', sshPrivateKey: 'key',
    } } as any, res as any);

    expect(res._status).toBe(400);
    expect(res._json.error).toContain('不能同时');
  });

  it('rejects a password attached to private-key mode even without a key', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: {
      ...baseBody, sshAuthMethod: 'privateKey', sshPassword: 'password',
    } } as any, res as any);

    expect(res._status).toBe(400);
    expect(res._json.error).toContain('不能同时');
  });

  it('rejects an encrypted private key', async () => {
    const encryptedKey = sshUtils.generateKeyPairSync('ed25519', {
      passphrase: 'test-passphrase', cipher: 'aes256-ctr', rounds: 16,
    }).private;
    const res = mockRes();
    await handler({ method: 'POST', body: {
      ...baseBody, sshAuthMethod: 'privateKey', sshPrivateKey: encryptedKey,
      sshPrivateKeyName: 'id_ed25519',
    } } as any, res as any);

    expect(res._status).toBe(400);
    expect(res._json.error).toContain('暂不支持带口令');
  });

  it('creates a password node without returning the password', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: {
      ...baseBody, sshAuthMethod: 'password', sshPassword: 'login-password',
    } } as any, res as any);

    expect(res._status).toBe(201);
    expect(writeNodeWithPrivateKey).toHaveBeenCalledWith(expect.objectContaining({
      ssh: expect.objectContaining({ authMethod: 'password', password: 'login-password' }),
    }), undefined);
    expect(JSON.stringify(res._json)).not.toContain('login-password');
  });

  it('creates a private-key node while keeping key content out of config and response', async () => {
    const privateKey = sshUtils.generateKeyPairSync('ed25519').private;
    const res = mockRes();
    await handler({ method: 'POST', body: {
      ...baseBody, sshAuthMethod: 'privateKey', sshPrivateKey: privateKey,
      sshPrivateKeyName: 'id_ed25519',
    } } as any, res as any);

    expect(res._status).toBe(201);
    expect(writeNodeWithPrivateKey).toHaveBeenCalledWith(expect.objectContaining({
      ssh: expect.objectContaining({ authMethod: 'privateKey' }),
    }), privateKey);
    expect(writeNodeWithPrivateKey.mock.calls[0][0].ssh).not.toHaveProperty('password');
    expect(JSON.stringify(writeNodeWithPrivateKey.mock.calls[0][0])).not.toContain(privateKey);
    expect(JSON.stringify(res._json)).not.toContain(privateKey);
  });
});
