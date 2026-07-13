// TDD RED phase for Task 4: HMAC verification middleware
// These tests verify HMAC signing, verification, replay protection, and localhost bypass

import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'crypto';

// The module doesn't exist yet — import will fail until GREEN phase
import { hmacVerify } from '../hmac';

// Helper to create a mock NextApiRequest
function mockReq(overrides: Partial<any> = {}): any {
  return {
    method: 'GET',
    url: '/api/status',
    headers: {},
    body: undefined,
    socket: { remoteAddress: '10.0.0.1' },
    ...overrides,
  };
}

// Helper to sign a request like NodeManager does
function signRequest(
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

describe('Task 4: HMAC Verification Middleware', () => {
  const TEST_SECRET = 'test-secret-key-64chars-long-padding-xxxxxxxxxxxxxxxxxxx';

  // Ensure unique timestamps between tests to avoid usedTimestamps collisions
  beforeEach(async () => {
    await new Promise(r => setTimeout(r, 2));
  });

  describe('hmacVerify', () => {
    it('should return valid for localhost requests', () => {
      const req = mockReq({
        socket: { remoteAddress: '127.0.0.1' },
      });
      const result = hmacVerify(req, TEST_SECRET);
      expect(result.valid).toBe(true);
    });

    it('should return valid for ::1 (IPv6 loopback)', () => {
      const req = mockReq({
        socket: { remoteAddress: '::1' },
      });
      const result = hmacVerify(req, TEST_SECRET);
      expect(result.valid).toBe(true);
    });

    it('should return valid for x-forwarded-for loopback', () => {
      const req = mockReq({
        socket: { remoteAddress: undefined },
        headers: { 'x-forwarded-for': '127.0.0.1' },
      });
      const result = hmacVerify(req, TEST_SECRET);
      expect(result.valid).toBe(true);
    });

    it('should reject request with missing auth headers', () => {
      const req = mockReq();
      const result = hmacVerify(req, TEST_SECRET);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('缺少');
    });

    it('should reject request with missing x-node-id', () => {
      const req = mockReq({
        headers: {
          'x-timestamp': Date.now().toString(),
          'x-signature': 'abc123',
        },
      });
      const result = hmacVerify(req, TEST_SECRET);
      expect(result.valid).toBe(false);
    });

    it('should accept request with valid signature', () => {
      const headers = signRequest('node-a', TEST_SECRET, 'GET', '/api/status');
      const req = mockReq({
        method: 'GET',
        url: '/api/status',
        headers,
      });
      const result = hmacVerify(req, TEST_SECRET);
      expect(result.valid).toBe(true);
    });

    it('should reject request with wrong secret', () => {
      const headers = signRequest('node-a', TEST_SECRET, 'GET', '/api/status');
      const req = mockReq({
        method: 'GET',
        url: '/api/status',
        headers,
      });
      const result = hmacVerify(req, 'wrong-secret');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('签名');
    });

    it('should reject expired timestamp (outside ±30s window)', () => {
      const oldTimestamp = (Date.now() - 60_000).toString(); // 60s ago
      const payload = `${oldTimestamp}\nGET\n/api/status\n`;
      const signature = crypto
        .createHmac('sha256', TEST_SECRET)
        .update(payload)
        .digest('hex');
      const req = mockReq({
        method: 'GET',
        url: '/api/status',
        headers: {
          'x-node-id': 'node-a',
          'x-timestamp': oldTimestamp,
          'x-signature': signature,
        },
      });
      const result = hmacVerify(req, TEST_SECRET);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('时间戳');
    });

    it('should reject replay of same timestamp', () => {
      // Use a unique timestamp to avoid collision with other tests' usedTimestamps
      const ts = (Date.now() + 5000).toString();
      const payload2 = `${ts}\nGET\n/api/status\n`;
      const sig2 = crypto.createHmac('sha256', TEST_SECRET).update(payload2).digest('hex');
      const h = { 'x-node-id': 'node-a', 'x-timestamp': ts, 'x-signature': sig2 };
      const req1 = mockReq({ method: 'GET', url: '/api/status', headers: h });
      const result1 = hmacVerify(req1, TEST_SECRET);
      expect(result1.valid).toBe(true);

      // Second request with same timestamp should fail (replay)
      const req2 = mockReq({ method: 'GET', url: '/api/status', headers: h });
      const result2 = hmacVerify(req2, TEST_SECRET);
      expect(result2.valid).toBe(false);
      expect(result2.error).toContain('重放');
    });

    it('should include method and path in signature verification', () => {
      // Sign for GET /api/status
      const headers = signRequest('node-a', TEST_SECRET, 'GET', '/api/status');
      // Try to use with POST /api/update
      const req = mockReq({
        method: 'POST',
        url: '/api/update',
        headers,
      });
      const result = hmacVerify(req, TEST_SECRET);
      expect(result.valid).toBe(false);
    });

    it('should handle requests with body', () => {
      const body = JSON.stringify({ action: 'update' });
      const headers = signRequest('node-a', TEST_SECRET, 'POST', '/api/update', body);
      const req = mockReq({
        method: 'POST',
        url: '/api/update',
        headers,
        body: { action: 'update' },
      });
      const result = hmacVerify(req, TEST_SECRET);
      expect(result.valid).toBe(true);
    });
  });
});
