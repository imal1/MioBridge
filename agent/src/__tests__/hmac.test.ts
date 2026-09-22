import { createHmac } from 'crypto';
import { describe, expect, it } from 'bun:test';
import { hmacVerify } from '../hmac';

const secret = 'shared-secret';

function request(path: string, timestamp: string) {
  const signature = createHmac('sha256', secret).update(`${timestamp}\nGET\n${path}\n`).digest('hex');
  return {
    method: 'GET', url: path, socket: { remoteAddress: '10.0.0.1' },
    headers: { 'x-node-id': 'node-a', 'x-timestamp': timestamp, 'x-signature': signature },
  };
}

describe('Agent HMAC replay protection', () => {
  it('accepts distinct signed requests from the same millisecond and rejects an exact replay', () => {
    const timestamp = String(Date.now());
    const status = request('/api/status', timestamp);
    const urls = request('/api/urls', timestamp);

    expect(hmacVerify(status, secret)).toEqual({ valid: true });
    expect(hmacVerify(urls, secret)).toEqual({ valid: true });
    expect(hmacVerify(status, secret)).toEqual({ valid: false, error: '重放请求' });
  });
});
