import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SubscriptionJobService, createNodeCore } from '../src/index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

async function fixture(options: { sources?: string[]; remoteErrors?: string[] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'miobridge-subscription-jobs-'));
  roots.push(root);
  const composition = createNodeCore({
    env: { MIOBRIDGE_CONFIG_DIR: root, PATH: '' },
    metadata: { version: 'test' },
    local: { isAvailable: async () => true, extractNodeUrls: async () => options.sources ?? ['vless://id@source.example:443#source'] },
    remote: { collectRemoteNodeSources: async () => ({ sources: [], errors: options.remoteErrors ?? [] }) },
    mihomo: {
      checkHealth: async () => true,
      getVersion: async () => ({ version: 'test' }),
      convertToClashByContent: async () => 'proxies:\n  - name: source\n',
    },
  });
  return { root, composition, service: new SubscriptionJobService(composition) };
}

async function terminal(service: SubscriptionJobService, jobId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await service.get(jobId);
    if (job && ['succeeded', 'partial', 'failed'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('subscription job did not finish');
}

describe('SubscriptionJobService', () => {
  it('persists step events, publishes validated artifacts, and restores history', async () => {
    const { composition, service } = await fixture();
    const { jobId } = await service.start({ idempotencyKey: 'same-request' });
    expect((await service.start({ idempotencyKey: 'same-request' })).jobId).toBe(jobId);
    const job = await terminal(service, jobId);
    expect(job).toMatchObject({ status: 'succeeded', step: 'done', progress: 100, nodesGenerated: 1, actorRole: 'admin' });
    expect((await service.events(jobId)).map(event => event.step)).toEqual(expect.arrayContaining(['collect', 'convert', 'validate', 'publish', 'backup', 'done']));
    expect(await service.artifacts()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'raw.txt', valid: true }),
      expect.objectContaining({ name: 'subscription.txt', valid: true }),
      expect.objectContaining({ name: 'clash.yaml', valid: true }),
    ]));
    const restored = new SubscriptionJobService(composition);
    expect((await restored.get(jobId))?.status).toBe('succeeded');
  });

  it('allows partial completion and blocks a zero-source job before creation', async () => {
    const partialFixture = await fixture({ remoteErrors: ['node offline'] });
    const partial = await terminal(partialFixture.service, (await partialFixture.service.start()).jobId);
    expect(partial.status).toBe('partial');
    expect(partial.warnings.join(' ')).toContain('远端');

    const emptyFixture = await fixture({ sources: [] });
    await expect(emptyFixture.service.start()).rejects.toThrow('零个可读代理来源');
    expect(await emptyFixture.service.list()).toEqual([]);
  });

  it('validates and persists the disabled-by-default schedule policy', async () => {
    const { service } = await fixture();
    expect(await service.policy()).toMatchObject({ enabled: false, cron: '0 */6 * * *', freshnessHours: 24, nodeDropPercent: 30, retryDelaysMinutes: [1, 5, 15] });
    const updated = await service.updatePolicy({ enabled: true, cron: '15 */6 * * *', freshnessHours: 12, nodeDropPercent: 20, retryDelaysMinutes: [1, 5], backupRetention: 10 });
    expect(updated).toMatchObject({ enabled: true, freshnessHours: 12, backupRetention: 10 });
    await expect(service.updatePolicy({ enabled: true, cron: '* *', freshnessHours: 12, nodeDropPercent: 20, retryDelaysMinutes: [], backupRetention: 10 })).rejects.toThrow('Cron');
  });
});
