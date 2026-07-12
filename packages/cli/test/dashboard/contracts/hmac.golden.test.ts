import { describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import { createHmacVerifier } from '../../../src/dashboard/server/hmac.js';

const SECRET = 'test-shared-secret-32-bytes!!!!!!';

function makeReq(overrides: Partial<{
  method: string; path: string; headers: Record<string, string>; body: unknown; remoteAddress: string;
}> = {}) {
  return {
    method: overrides.method ?? 'GET',
    path: overrides.path ?? '/api/status',
    headers: overrides.headers ?? {},
    body: overrides.body,
    remoteAddress: overrides.remoteAddress ?? '10.0.0.1',
  };
}

function sign(method: string, path: string, body: unknown, secret: string, timestamp?: number) {
  const ts = String(timestamp ?? Date.now());
  const payload = `${ts}\n${method}\n${path}\n${body ? JSON.stringify(body) : ''}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return { ts, sig };
}

describe('HMAC golden contract', () => {
  it('allows localhost without headers', () => {
    const verify = createHmacVerifier(SECRET);
    expect(verify(makeReq({ remoteAddress: '127.0.0.1' }))).toEqual({ valid: true });
    expect(verify(makeReq({ remoteAddress: '::1' }))).toEqual({ valid: true });
  });

  it('rejects missing headers', () => {
    const verify = createHmacVerifier(SECRET);
    expect(verify(makeReq({ remoteAddress: '10.0.0.1' })).valid).toBe(false);
  });

  it('rejects expired timestamp', () => {
    const verify = createHmacVerifier(SECRET);
    const { ts, sig } = sign('GET', '/api/status', null, SECRET, Date.now() - 60_000);
    const result = verify(makeReq({
      headers: { 'x-node-id': 'n1', 'x-timestamp': ts, 'x-signature': sig },
    }));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('时间戳超出窗口');
  });

  it('rejects replayed timestamp', () => {
    const verify = createHmacVerifier(SECRET);
    const now = Date.now();
    const { ts, sig } = sign('GET', '/api/status', null, SECRET, now);
    const req = makeReq({
      headers: { 'x-node-id': 'n1', 'x-timestamp': ts, 'x-signature': sig },
    });
    expect(verify(req).valid).toBe(true);
    // Replay must fail
    expect(verify(req).valid).toBe(false);
  });

  it('rejects wrong signature', () => {
    const verify = createHmacVerifier(SECRET);
    const { ts } = sign('GET', '/api/status', null, SECRET);
    const result = verify(makeReq({
      headers: { 'x-node-id': 'n1', 'x-timestamp': ts, 'x-signature': 'deadbeef' },
    }));
    expect(result.valid).toBe(false);
  });

  it('accepts valid signed request', () => {
    const verify = createHmacVerifier(SECRET);
    const { ts, sig } = sign('POST', '/api/update', { key: 'val' }, SECRET);
    const result = verify(makeReq({
      method: 'POST',
      path: '/api/update',
      headers: { 'x-node-id': 'n1', 'x-timestamp': ts, 'x-signature': sig },
      body: { key: 'val' },
    }));
    expect(result).toEqual({ valid: true });
  });

  it('skips HMAC when secret is empty', () => {
    const noop = createHmacVerifier('');
    const result = noop(makeReq({ remoteAddress: '10.0.0.1' }));
    expect(result).toEqual({ valid: true });
  });
});
