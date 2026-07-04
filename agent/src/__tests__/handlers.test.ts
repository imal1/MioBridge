import { describe, it, expect } from 'bun:test';
import { handleStatus } from '../handlers/status';
import { handleUpdate } from '../handlers/update';
import { handleHealth } from '../handlers/health';
import { handleLogs } from '../handlers/logs';
import type { AgentConfig } from '../config';
import * as crypto from 'crypto';

const MOCK_CONFIG: AgentConfig = {
  node: { id: 'node-sg', name: '新加坡', secret: 'test-secret' },
  kernel: { type: 'xray', configPath: '/nonexistent/xray.json' },
  mihomo: { path: '/nonexistent/mihomo' },
  port: 3001,
};

function mockReq(overrides: any = {}): any {
  return {
    method: 'GET',
    url: '/api/status',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  };
}

describe('handleStatus', () => {
  it('should return StatusInfo JSON', async () => {
    const req = mockReq();
    const res = await handleStatus(req, MOCK_CONFIG);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(typeof body.data.nodesCount).toBe('number');
    expect(typeof body.data.mihomoAvailable).toBe('boolean');
  });

  it('should reject unauthenticated remote request', async () => {
    const req = mockReq({
      socket: { remoteAddress: '10.0.0.1' },
      headers: {},
    });
    const res = await handleStatus(req, {
      ...MOCK_CONFIG,
      node: { ...MOCK_CONFIG.node, secret: 'abc123' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('认证失败');
  });

  it('should accept request with valid HMAC signature', async () => {
    const secret = 'test-hmac-secret-32chars-long!';
    const timestamp = Date.now().toString();
    const method = 'GET';
    const reqPath = '/api/status';
    const payload = `${timestamp}\n${method}\n${reqPath}\n`;
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    const req = mockReq({
      method,
      url: reqPath,
      socket: { remoteAddress: '10.0.0.1' },
      headers: {
        'x-node-id': 'control-plane',
        'x-timestamp': timestamp,
        'x-signature': signature,
      },
    });
    const res = await handleStatus(req, {
      ...MOCK_CONFIG,
      node: { ...MOCK_CONFIG.node, secret },
    });
    expect(res.status).not.toBe(401);
  });
});

describe('handleHealth', () => {
  it('should return health status JSON', () => {
    const req = mockReq();
    const res = handleHealth(req, MOCK_CONFIG);
    expect(res.status).toBe(200);
  });

  it('should include uptime and memory', async () => {
    const req = mockReq();
    const res = handleHealth(req, MOCK_CONFIG);
    const body = await res.json();
    expect(body.uptime).toBeDefined();
    expect(body.memory).toBeDefined();
    expect(body.version).toBe('1.0.0');
  });
});

describe('handleLogs', () => {
  it('should return logs JSON', async () => {
    const req = mockReq({ url: '/api/logs' });
    const res = await handleLogs(req, MOCK_CONFIG);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.file).toBeDefined();
    expect(Array.isArray(body.data.files)).toBe(true);
    expect(Array.isArray(body.data.lines)).toBe(true);
  });
});

describe('handleUpdate', () => {
  it('should return update result with message', async () => {
    const req = mockReq({ url: '/api/update' });
    const res = await handleUpdate(req, MOCK_CONFIG);
    const body = await res.json();
    expect(body.success).toBeDefined();
    expect(body.message).toBeDefined();
  });
});
