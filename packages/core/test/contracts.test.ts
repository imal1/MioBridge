import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const fixturePath = fileURLToPath(new URL('./fixtures/migration-before.json', import.meta.url));

describe('migration-before behavior contract', () => {
  it('freezes artifact bytes and source ordering/deduplication/naming', async () => {
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));

    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.sourceNormalization.deduplicatedNodeIds).toEqual(['local', 'remote']);
    expect(fixture.sourceNormalization.clashNames).toHaveLength(2);
    expect(fixture.artifacts.subscriptionUtf8).toBe(fixture.artifacts.raw);
    expect(fixture.artifacts.clash.endsWith('\n')).toBe(true);
  });

  it('freezes partial/total failure, status, offline-node, and HMAC error shapes', async () => {
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));

    expect(fixture.failureContracts.partial).toMatchObject({ success: true, preserveUsableSources: true });
    expect(fixture.failureContracts.total).toMatchObject({ rejects: true, replacementAllowed: false });
    expect(fixture.status.fields).toContain('proxyCount');
    expect(fixture.status.offlineNode).toEqual({ status: 'offline', proxyCount: 0, sources: [] });
    expect(fixture.hmacErrors).toEqual(expect.arrayContaining(['invalid signature', 'timeout']));
  });
});
