import { randomUUID } from 'node:crypto';
import type { StateStore } from '../state/stateStore.js';
import type { NotificationWebhookConfig } from '../types/config.js';
export type NotificationEvent = 'subscription.failed' | 'subscription.blocked' | 'node.offline' | 'node.recovered' | 'deployment.failed' | 'agent.outdated' | 'test';
export class WebhookService {
  constructor(private readonly state: StateStore, private readonly config: () => NotificationWebhookConfig | undefined,
    private readonly fetcher: typeof fetch = fetch, private readonly delay: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {}
  async send(event: NotificationEvent, message: string): Promise<{ id: string; ok: boolean; statusCode?: number; event: string; timestamp: string; attempts: number } | null> {
    const config = this.config();
    if (!config?.enabled || !config.url || (event !== 'test' && !config.events?.includes(event))) return null;
    const url = new URL(config.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Webhook 必须使用 HTTP(S)');
    const timestamp = new Date().toISOString();
    const text = `[MioBridge] ${event}: ${message}`;
    const body = config.template === 'telegram' ? { chat_id: config.target, text }
      : config.template === 'bark' ? { title: 'MioBridge', body: text }
      : config.template === 'wechat' ? { msgtype: 'text', text: { content: text } }
      : { event, message, timestamp };
    let statusCode: number | undefined; let ok = false; let attempts = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      attempts++;
      try {
        const response = await this.fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000), redirect: 'error' });
        statusCode = response.status; ok = response.ok; await response.body?.cancel();
        if (ok) break;
      } catch { /* Never persist endpoint URLs, credentials, or response bodies. */ }
      if (attempt < 3) await this.delay(1000 * 2 ** attempt);
    }
    const record = { id: `${Date.now()}-${randomUUID()}`, event, timestamp, ok, attempts, ...(statusCode !== undefined ? { statusCode } : {}) };
    await this.state.set(`notifications/${record.id}.json`, JSON.stringify(record));
    const keys = (await this.state.listKeys('notifications/')).sort().reverse();
    for (const key of keys.slice(100)) await this.state.del(key);
    return record;
  }
}
