import * as crypto from 'node:crypto';

const TIME_WINDOW_MS = 30_000; // ±30s
const CLEANUP_INTERVAL_MS = 60_000;

/** Framework-agnostic HMAC request shape — mirrors the Next.js HMAC contract. */
export interface HmacRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body?: unknown;
  readonly remoteAddress: string;
}

export interface HmacVerifyResult {
  readonly valid: boolean;
  readonly error?: string;
}

/**
 * Canonical HMAC verifier with timestamp window, replay protection, and
 * timing-safe signature comparison.  Localhost is always allowed.
 *
 * This is the authoritative port of `frontend/src/server/middleware/hmac.ts`
 * into the framework-free CLI dashboard server.  Every behaviour change must
 * go through golden contract tests.
 */
export function createHmacVerifier(secret: string) {
  const usedTimestamps = new Set<string>();
  let lastCleanup = Date.now();

  function cleanup(): void {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
    usedTimestamps.clear();
    lastCleanup = now;
  }

  return function hmacVerify(req: HmacRequest): HmacVerifyResult {
    if (!secret) return { valid: true };

    const remoteAddr = req.remoteAddress || '';
    if (remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === 'localhost') {
      return { valid: true };
    }

    const nodeId = req.headers['x-node-id'];
    const timestamp = req.headers['x-timestamp'];
    const signature = req.headers['x-signature'];

    if (!nodeId || !timestamp || !signature) {
      return { valid: false, error: '缺少 HMAC 认证头' };
    }
    if (Array.isArray(nodeId) || Array.isArray(timestamp) || Array.isArray(signature)) {
      return { valid: false, error: 'HMAC 认证头格式错误' };
    }

    const reqTime = parseInt(timestamp, 10);
    const now = Date.now();
    if (isNaN(reqTime) || Math.abs(now - reqTime) > TIME_WINDOW_MS) {
      return { valid: false, error: `时间戳超出窗口 (${TIME_WINDOW_MS / 1000}s)` };
    }

    cleanup();
    if (usedTimestamps.has(timestamp)) {
      return { valid: false, error: '重放请求' };
    }
    usedTimestamps.add(timestamp);

    const body = req.body ? JSON.stringify(req.body) : '';
    const payload = `${timestamp}\n${req.method}\n${req.path}\n${body}`;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    try {
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return { valid: false, error: '签名不匹配' };
      }
    } catch {
      return { valid: false, error: '签名格式错误' };
    }

    return { valid: true };
  };
}
