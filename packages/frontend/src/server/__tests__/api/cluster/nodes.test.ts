import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { utils as sshUtils } from 'ssh2';

const writeNodeWithPrivateKey = vi.fn(async (node) => ({ ...node, id: 'node-test' }));
const loadNodes = vi.fn();
const updateNodeKernels = vi.fn();

vi.mock('@/server/services/nodeManager', () => ({
  NodeManager: { getInstance: () => ({ writeNodeWithPrivateKey, loadNodes, updateNodeKernels }) },
}));

let handler: typeof import('@/pages/api/cluster/nodes').default;

function mockRes() {
  return {
    _status: 200,
    _json: undefined as any,
    status(code: number) { this._status = code; return this; },
    json(value: any) { this._json = value; return this; },
  };
}

const baseBody = {
  name: 'Test node', host: 'node.example.com', kernels: [{ type: 'sing-box' }],
  location: 'test', sshUser: 'root',
};

beforeAll(async () => {
  handler = (await import('@/pages/api/cluster/nodes')).default;
});

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

describe('POST /api/cluster/nodes kernels', () => {
  beforeEach(() => writeNodeWithPrivateKey.mockClear());

  it.each([
    ['absent', undefined, '至少选择一个内核'],
    ['empty', [], '至少选择一个内核'],
    ['duplicate', [{ type: 'xray' }, { type: 'xray' }], '内核类型重复: xray'],
    ['unsupported', [{ type: 'clash' }], '不支持的内核类型: clash'],
  ])('rejects %s kernels', async (_name, kernels, message) => {
    const body = { ...baseBody, sshAuthMethod: 'password', sshPassword: 'login-password' } as any;
    if (kernels === undefined) delete body.kernels;
    else body.kernels = kernels;
    const res = mockRes();

    await handler({ method: 'POST', body } as any, res as any);

    expect(res._status).toBe(400);
    expect(res._json.error).toBe(message);
    expect(writeNodeWithPrivateKey).not.toHaveBeenCalled();
  });

  it('normalizes valid kernels before creating the node', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: {
      ...baseBody,
      kernels: [{ type: 'v2ray' }, { type: 'sing-box' }, { type: 'xray', configPath: '/custom/xray.json' }],
      sshAuthMethod: 'password', sshPassword: 'login-password',
    } } as any, res as any);

    expect(res._status).toBe(201);
    expect(writeNodeWithPrivateKey.mock.calls[0][0].kernels).toEqual([]);
  });

  it('rejects unknown kernel config keys', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: {
      ...baseBody, kernels: [{ type: 'xray', typo: true }],
      sshAuthMethod: 'password', sshPassword: 'login-password',
    } } as any, res as any);

    expect(res._status).toBe(400);
    expect(res._json.error).toBe('内核配置包含未知字段: typo');
    expect(writeNodeWithPrivateKey).not.toHaveBeenCalled();
  });

  it('rejects a dangerous kernel config path without writing the node', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: {
      ...baseBody,
      kernels: [{ type: 'xray', configPath: '/etc/xray/config.json\nYAML_EOF\ntouch /tmp/pwned' }],
      sshAuthMethod: 'password', sshPassword: 'login-password',
    } } as any, res as any);

    expect(res._status).toBe(400);
    expect(res._json.error).toBe('内核配置路径无效: xray');
    expect(writeNodeWithPrivateKey).not.toHaveBeenCalled();
  });
});

describe('PUT /api/cluster/nodes kernels', () => {
  const savedNode = {
    id: 'node-edit', name: 'Edited node', host: 'edit.example.com', location: 'JP', enabled: true,
    secret: 'secret',
    kernels: [
      { type: 'sing-box', configPath: '/custom/sing-box.json' },
      { type: 'xray', configPath: '/custom/xray.json' },
    ],
    ssh: { user: 'root', authMethod: 'password', hostKey: '', password: 'sensitive' },
  };

  beforeEach(() => {
    loadNodes.mockReset();
    updateNodeKernels.mockReset();
    loadNodes.mockResolvedValue([savedNode]);
    updateNodeKernels.mockImplementation(async (_nodeId, kernels) => ({ ...savedNode, kernels }));
  });

  it('rejects direct kernel writes so deployment remains the only commit path', async () => {
    const res = mockRes();
    await handler({ method: 'PUT', body: { nodeId: 'node-edit', kernels: [{ type: 'xray' }] } } as any, res as any);
    expect(res._status).toBe(405);
    expect(updateNodeKernels).not.toHaveBeenCalled();
  });
});
