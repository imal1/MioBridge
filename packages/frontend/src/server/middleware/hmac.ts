import type { NextApiRequest } from 'next';
import * as crypto from 'crypto';

const TIME_WINDOW_MS = 30_000; // ±30s

/** 已使用的时间戳集合（防重放），每 60s 清理 */
const usedTimestamps = new Set<string>();
let lastCleanup = Date.now();

function cleanupTimestamps(): void {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  usedTimestamps.clear();
  lastCleanup = now;
}

/**
 * 验证 HMAC 签名
 * @param req NextApiRequest
 * @param secret 共享密钥
 * @returns 验证结果
 */
export function hmacVerify(
  req: NextApiRequest,
  secret: string,
): { valid: boolean; error?: string } {
  // 1. localhost 跳过验证
  const remoteAddr = req.socket?.remoteAddress || req.headers['x-forwarded-for'] || '';
  if (remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === 'localhost') {
    return { valid: true };
  }

  // 2. 提取请求头
  const nodeId = req.headers['x-node-id'] as string;
  const timestamp = req.headers['x-timestamp'] as string;
  const signature = req.headers['x-signature'] as string;

  if (!nodeId || !timestamp || !signature) {
    return { valid: false, error: '缺少 HMAC 认证头' };
  }

  // 3. 检查时间窗口
  const reqTime = parseInt(timestamp, 10);
  const now = Date.now();
  if (isNaN(reqTime) || Math.abs(now - reqTime) > TIME_WINDOW_MS) {
    return { valid: false, error: `时间戳超出窗口 (${TIME_WINDOW_MS / 1000}s)` };
  }

  // 4. 防重放
  cleanupTimestamps();
  if (usedTimestamps.has(timestamp)) {
    return { valid: false, error: '重放请求' };
  }
  usedTimestamps.add(timestamp);

  // 5. 重新计算签名并比对
  const method = req.method || 'GET';
  const reqPath = req.url || '/';
  const body = req.body ? JSON.stringify(req.body) : '';
  const payload = `${timestamp}\n${method}\n${reqPath}\n${body}`;

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
}
