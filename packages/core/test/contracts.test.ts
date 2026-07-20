import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactService } from '../src/index.js';

const fixturePath = fileURLToPath(new URL('./fixtures/behavior-contract.json', import.meta.url));
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

describe('artifact behavior contract', () => {
  it('freezes artifact bytes and source ordering/deduplication/naming', async () => {
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));

    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.sourceNormalization.deduplicatedNodeIds).toEqual(['local', 'remote']);
    expect(fixture.sourceNormalization.clashNames).toHaveLength(2);
    const root = await mkdtemp(join(tmpdir(), 'miobridge-contract-')); roots.push(root);
    const config = { staticDir: join(root, 'www'), logDir: join(root, 'log'), backupDir: join(root, 'backup'), clashFilename: 'clash.yaml' };
    const urls = fixture.artifacts.raw.split('\n');
    const service = new ArtifactService({ config, logger: { debug() {}, info() {}, warn() {}, error() {} },
      now: () => new Date('2026-07-12T00:00:00Z'),
      local: { isAvailable: async () => true, extractNodeUrls: async () => [urls[0]] },
      remote: { collectRemoteNodeSources: async () => ({ sources: [{ url: urls[1], kernel: 'xray', nodeId: 'remote', location: '香港' }], errors: ['partial'] }) },
      clash: { checkHealth: async () => true, convertToClashByContent: async () => fixture.artifacts.clash },
    });
    const result = await service.updateSubscription();
    expect(await readFile(join(config.staticDir, 'raw.txt'), 'utf8')).toBe(fixture.artifacts.raw);
    expect(Buffer.from(await readFile(join(config.staticDir, 'subscription.txt'), 'utf8'), 'base64').toString()).toBe(fixture.artifacts.subscriptionDecoded);
    expect(await readFile(join(config.staticDir, 'clash.yaml'), 'utf8')).toBe(fixture.artifacts.clash);
    expect(result).toMatchObject({ success: true, clashGenerated: true, nodesCount: 2, warnings: ['节点: partial'] });
  });

  it('freezes partial/total failure, status, offline-node, and HMAC error shapes', async () => {
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));

    expect(fixture.failureContracts.partial).toMatchObject({ success: true, preserveUsableSources: true });
    expect(fixture.failureContracts.total).toMatchObject({ rejects: true, replacementAllowed: false });
    expect(fixture.status.fields).toContain('nodesCount');
    expect(fixture.status.offlineNode).toEqual({ status: 'offline', proxyCount: 0, sources: [] });
    expect(fixture.hmacErrors).toEqual(expect.arrayContaining(['invalid signature', 'timeout']));
  });
});
