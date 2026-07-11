import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { utils as sshUtils } from 'ssh2';

const loadNodes = vi.fn();
const getNodePrivateKey = vi.fn();
const detectKernels = vi.fn();
const loggerError = vi.fn();

vi.mock('@/server/services/nodeManager', () => ({
  NodeManager: { getInstance: () => ({ loadNodes, getNodePrivateKey }) },
}));

vi.mock('@/server/services/deployManager', () => ({
  DeployManager: { getInstance: () => ({ detectKernels }) },
}));

vi.mock('@/server/utils/logger', () => ({
  logger: { error: loggerError },
}));

let handler: typeof import('@/pages/api/cluster/kernel/detect').default;

function mockRes() {
  return {
    _status: 200,
    _json: undefined as any,
    status(code: number) { this._status = code; return this; },
    json(value: any) { this._json = value; return this; },
  };
}

const detections = [
  { type: 'sing-box', installed: true, version: 'sing-box 1.11', defaultConfigPath: '/etc/sing-box/config.json' },
  { type: 'xray', installed: false, defaultConfigPath: '/usr/local/etc/xray/config.json', error: 'not found' },
  { type: 'v2ray', installed: true, version: 'V2Ray 5.0', defaultConfigPath: '/etc/v2ray/config.json' },
];

describe('POST /api/cluster/kernel/detect', () => {
  beforeAll(async () => {
    handler = (await import('@/pages/api/cluster/kernel/detect')).default;
  });
  beforeEach(() => {
    vi.clearAllMocks();
    detectKernels.mockResolvedValue(detections);
  });

  it('rejects methods other than POST', async () => {
    const res = mockRes();
    await handler({ method: 'GET' } as any, res as any);
    expect(res._status).toBe(405);
  });

  it('rejects a request without a saved node or SSH connection data', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: {} } as any, res as any);
    expect(res._status).toBe(400);
    expect(res._json.error).toContain('SSH');
  });

  it('loads a saved node and resolves its private key transiently', async () => {
    const node = {
      id: 'saved', name: 'Saved', host: 'saved.example.com', secret: 'secret',
      kernels: [{ type: 'sing-box' }], location: 'test', enabled: true,
      ssh: { user: 'root', port: 22, authMethod: 'privateKey', credentialRef: 'ssh-keys/saved', hostKey: 'host-key' },
    };
    loadNodes.mockResolvedValue([node]);
    getNodePrivateKey.mockResolvedValue('PRIVATE KEY MATERIAL');
    const res = mockRes();

    await handler({ method: 'POST', body: { nodeId: 'saved' } } as any, res as any);

    expect(getNodePrivateKey).toHaveBeenCalledWith(node);
    expect(detectKernels).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: 'saved',
      ssh: expect.objectContaining({ host: 'saved.example.com', privateKey: 'PRIVATE KEY MATERIAL' }),
    }));
    expect(res._status).toBe(200);
    expect(res._json.data).toEqual(detections);
    expect(JSON.stringify(res._json)).not.toContain('PRIVATE KEY MATERIAL');
    expect(JSON.stringify(res._json)).not.toContain('host-key');
  });

  it('accepts minimal unsaved SSH data and sanitizes credentials from the response', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: { ssh: {
      host: 'new.example.com', user: 'admin', port: 2222,
      authMethod: 'password', password: 'login-password', hostKey: '',
    } } } as any, res as any);

    expect(detectKernels).toHaveBeenCalledWith(expect.objectContaining({
      ssh: expect.objectContaining({ host: 'new.example.com', password: 'login-password' }),
    }));
    expect(res._json.data).toHaveLength(3);
    expect(JSON.stringify(res._json)).not.toContain('login-password');
    expect(JSON.stringify(res._json)).not.toContain('new.example.com');
  });

  it.each([
    ['password with private key', { authMethod: 'password', password: 'pw', privateKey: 'key' }],
    ['private key with password', { authMethod: 'privateKey', password: 'pw', privateKey: 'key' }],
  ])('rejects mixed unsaved credentials: %s', async (_name, credentials) => {
    const res = mockRes();
    await handler({ method: 'POST', body: { ssh: {
      host: 'new.example.com', user: 'root', hostKey: '', ...credentials,
    } } } as any, res as any);

    expect(res._status).toBe(400);
    expect(res._json.error).toContain('不能同时');
    expect(detectKernels).not.toHaveBeenCalled();
  });

  it('accepts a valid unsaved private key transiently', async () => {
    const privateKey = sshUtils.generateKeyPairSync('ed25519').private;
    const res = mockRes();
    await handler({ method: 'POST', body: { ssh: {
      host: 'new.example.com', user: 'root', authMethod: 'privateKey', privateKey, hostKey: '',
    } } } as any, res as any);

    expect(res._status).toBe(200);
    expect(detectKernels).toHaveBeenCalledWith(expect.objectContaining({
      ssh: expect.objectContaining({ privateKey }),
    }));
    expect(JSON.stringify(res._json)).not.toContain(privateKey);
  });

  it.each([
    ['malformed', 'not-a-private-key', '无效的 SSH 私钥文件'],
    ['encrypted', '-----BEGIN ENCRYPTED PRIVATE KEY-----\nabc\n-----END ENCRYPTED PRIVATE KEY-----', '暂不支持带口令'],
    ['oversized', `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(70 * 1024)}\n-----END PRIVATE KEY-----`, '64 KiB'],
  ])('rejects an %s unsaved private key', async (_name, privateKey, message) => {
    const res = mockRes();
    await handler({ method: 'POST', body: { ssh: {
      host: 'new.example.com', user: 'root', authMethod: 'privateKey', privateKey, hostKey: '',
    } } } as any, res as any);

    expect(res._status).toBe(400);
    expect(res._json.error).toContain(message);
    expect(detectKernels).not.toHaveBeenCalled();
  });

  it('maps lower-level SSH errors to a fixed sanitized response and log message', async () => {
    const sensitive = 'login-password token-123';
    detectKernels.mockRejectedValue(new Error(`ssh2 failed with ${sensitive}`));
    const res = mockRes();

    await handler({ method: 'POST', body: { ssh: {
      host: 'new.example.com', user: 'root', authMethod: 'password', password: 'login-password', hostKey: '',
    } } } as any, res as any);

    expect(res._status).toBe(502);
    expect(res._json.error).toBe('内核检测失败，请检查 SSH 连接信息');
    expect(JSON.stringify(res._json)).not.toContain(sensitive);
    expect(loggerError).toHaveBeenCalled();
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain('login-password');
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain('token-123');
  });
});
