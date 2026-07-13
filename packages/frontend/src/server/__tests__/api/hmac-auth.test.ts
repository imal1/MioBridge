// TDD for Task 6: HMAC verification on existing API routes
// ESM imports are hoisted, so we use vi.stubEnv + dynamic imports

import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as crypto from 'crypto';

const TEST_SECRET = 'test-secret-key-64chars-long-padding-xxxxxxxxxxxxxxxxxxx';

function mockRes() {
  const res: any = {
    _status: 200,
    _json: null,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(data: any) {
      this._json = data;
      return this;
    },
  };
  return res;
}

function signHeaders(
  nodeId: string,
  secret: string,
  method: string,
  path: string,
  body?: string,
): Record<string, string> {
  const timestamp = Date.now().toString();
  const payload = `${timestamp}\n${method}\n${path}\n${body ?? ''}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return {
    'x-node-id': nodeId,
    'x-timestamp': timestamp,
    'x-signature': signature,
  };
}

describe('Task 6: HMAC Auth on Existing APIs', () => {
  let statusHandler: any;
  let updateHandler: any;
  let healthHandler: any;

  beforeAll(async () => {
    // Set env BEFORE importing handlers (they read process.env at module eval time)
    vi.stubEnv('MIOBRIDGE_NODE_SECRET', TEST_SECRET);

    statusHandler = (await import('@/pages/api/status')).default;
    updateHandler = (await import('@/pages/api/update')).default;
    healthHandler = (await import('@/pages/api/health')).default;
  });

  describe('GET /api/status — HMAC enforcement', () => {
    it('should reject remote request WITHOUT valid HMAC (returns 401)', async () => {
      const req: any = {
        method: 'GET', url: '/api/status', headers: {},
        socket: { remoteAddress: '10.0.0.1' },
      };
      const res = mockRes();
      await statusHandler(req, res);
      expect(res._status).toBe(401);
      expect(res._json.error).toContain('认证失败');
    });

    it('should accept remote request WITH valid HMAC signature', async () => {
      const headers = signHeaders('node-a', TEST_SECRET, 'GET', '/api/status');
      const req: any = {
        method: 'GET', url: '/api/status', headers,
        socket: { remoteAddress: '10.0.0.1' },
      };
      const res = mockRes();
      await statusHandler(req, res);
      expect(res._status).toBe(200);
    });

    it('should accept localhost request without HMAC (bypass)', async () => {
      const req: any = {
        method: 'GET', url: '/api/status', headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      };
      const res = mockRes();
      await statusHandler(req, res);
      expect(res._status).toBe(200);
    });
  });

  describe('POST /api/update — HMAC enforcement', () => {
    it('should reject remote request WITHOUT valid HMAC (returns 401)', async () => {
      const req: any = {
        method: 'POST', url: '/api/update', headers: {},
        socket: { remoteAddress: '10.0.0.1' },
      };
      const res = mockRes();
      await updateHandler(req, res);
      expect(res._status).toBe(401);
      expect(res._json.error).toContain('认证失败');
    });

    it('should accept localhost request without HMAC', async () => {
      const req: any = {
        method: 'POST', url: '/api/update', headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      };
      const res = mockRes();
      await updateHandler(req, res);
      expect(typeof res._json.success).toBe('boolean');
    });
  });

  describe('GET /api/health — HMAC enforcement', () => {
    it('should reject remote request WITHOUT valid HMAC (returns 401)', async () => {
      const req: any = {
        method: 'GET', url: '/api/health', headers: {},
        socket: { remoteAddress: '10.0.0.1' },
      };
      const res = mockRes();
      await healthHandler(req, res);
      expect(res._status).toBe(401);
      expect(res._json.error).toContain('认证失败');
    });

    it('should accept localhost request without HMAC', async () => {
      const req: any = {
        method: 'GET', url: '/api/health', headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      };
      const res = mockRes();
      await healthHandler(req, res);
      expect(res._json.status).toBe('healthy');
    });
  });
});
