import { describe, expect, it } from 'vitest';
import { MetricsService, type StateStore, type StatusInfo } from '../src/index.js';

const now = new Date('2026-07-24T00:00:10.000Z');

function status(overrides: Partial<StatusInfo> = {}): StatusInfo {
  return {
    subscriptionExists: true, clashExists: true, rawExists: true, mihomoAvailable: true,
    uptime: 42, version: '1.2.3', nodesCount: 7,
    rawLastUpdated: '2026-07-24T00:00:00.000Z', rawSize: 100,
    subscriptionSize: 200, clashSize: 300, ...overrides,
  };
}

function store(value: string | null): StateStore {
  return { kind: 'file', get: async () => value, set: async () => {}, del: async () => {}, withLock: async (_k, fn) => fn() };
}

describe('MetricsService', () => {
  it('derives ages, proxies, and cluster counts', async () => {
    const service = new MetricsService(async () => status(), store(null), { snapshot: async () => ({ enabledNodes: 3, onlineNodes: 2, sources: 5 }) }, () => now);
    const snapshot = await service.snapshot();
    expect(snapshot).toMatchObject({
      timestamp: now.toISOString(), version: '1.2.3', uptime: 42, proxies: 7,
      enabledNodes: 3, onlineNodes: 2, sources: 5, mihomoAvailable: true,
    });
    expect(snapshot.artifacts.raw).toEqual({ exists: true, ageSeconds: 10, size: 100 });
    expect(snapshot.lastGeneration).toBeUndefined();
  });

  it('defaults cluster to zeros when no source provided', async () => {
    const service = new MetricsService(async () => status(), store(null), undefined, () => now);
    const snapshot = await service.snapshot();
    expect({ e: snapshot.enabledNodes, o: snapshot.onlineNodes, s: snapshot.sources }).toEqual({ e: 0, o: 0, s: 0 });
  });

  it('omits age and size when the status lacks them', async () => {
    const service = new MetricsService(async () => status({ rawLastUpdated: undefined, rawSize: undefined, rawExists: false }), store(null), undefined, () => now);
    expect((await service.snapshot()).artifacts.raw).toEqual({ exists: false });
  });

  it('parses a valid generation record and ignores malformed ones', async () => {
    const good = new MetricsService(async () => status(), store(JSON.stringify({ status: 'partial', timestamp: 't', durationMs: 5 })), undefined, () => now);
    expect((await good.snapshot()).lastGeneration).toEqual({ status: 'partial', timestamp: 't', durationMs: 5 });

    for (const raw of ['not-json', JSON.stringify({ status: 'bogus', timestamp: 't' }), JSON.stringify({ status: 'success' })]) {
      const svc = new MetricsService(async () => status(), store(raw), undefined, () => now);
      expect((await svc.snapshot()).lastGeneration).toBeUndefined();
    }
  });
});
