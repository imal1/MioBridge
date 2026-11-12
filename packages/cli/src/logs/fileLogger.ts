import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { CoreLogger } from '@miobridge/core';
const levels = ['debug', 'info', 'warn', 'error'] as const;
export function createFileLogger(directory: string, settings: () => { level?: string; retentionDays?: number }): CoreLogger {
  let lastDay = '';
  const write = (level: typeof levels[number], message: string, metadata?: Readonly<Record<string, unknown>>) => {
    const config = settings();
    if (levels.indexOf(level) < Math.max(0, levels.indexOf((config.level ?? 'info') as typeof level))) return;
    const date = new Date(); const day = date.toISOString().slice(0, 10);
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (lastDay !== day) {
        for (const name of readdirSync(directory)) {
          const stamp = name.match(/^miobridge-(\d{4}-\d{2}-\d{2})\.log$/)?.[1];
          if (stamp && Date.parse(stamp) < date.getTime() - (config.retentionDays ?? 14) * 86400000) rmSync(join(directory, name));
        }
        lastDay = day;
      }
      const redact = (value: unknown): unknown => {
        if (typeof value === 'string') return value.replace(/(?:vless|vmess|trojan|ss|hysteria2|hy2|tuic):\/\/\S+/gi, '[代理凭据已隐藏]').replace(/token=[^\s&]+/gi, 'token=[已隐藏]');
        if (value instanceof Error) return redact(value.message);
        if (Array.isArray(value)) return value.map(redact);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /password|secret|token|privatekey/i.test(key) ? '[已隐藏]' : redact(item)]));
        return value;
      };
      appendFileSync(join(directory, `miobridge-${day}.log`), JSON.stringify({ timestamp: date.toISOString(), level, message: redact(message), ...(metadata ? { metadata: redact(metadata) } : {}) }) + '\n', { mode: 0o600 });
    } catch (error) { process.stderr.write(`日志写入失败: ${error instanceof Error ? error.message : 'unknown'}\n`); }
  };
  return { debug: (m, d) => write('debug', m, d), info: (m, d) => write('info', m, d), warn: (m, d) => write('warn', m, d), error: (m, d) => write('error', m, d) };
}
