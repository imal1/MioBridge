import { describe, expect, it } from 'vitest';
import { AgentClient, NodeAggregationService, NodeRepository, type StateStore } from '../../src/index.js';

function heartbeatFixture() {
  const entries = new Map<string, string>();
  const state: StateStore = {
    kind: 'file', get: async key => entries.get(key) ?? null,
    set: async (key, value) => { entries.set(key, value); },
    del: async key => { entries.delete(key); }, withLock: async (_key, fn) => fn(),
  };
  const repository = new NodeRepository(state);
  let clock = Date.parse('2026-09-24T00:00:00Z');
  let failure: 'timeout' | 'connection' | undefined;
  const client = new AgentClient({ fetch: (async (input: string | URL | Request) => {
    if (failure === 'timeout') return new Promise(() => {});
    if (failure === 'connection') throw new Error('connection refused');
    return new Response(JSON.stringify(new URL(String(input)).pathname === '/health'
      ? { status: 'healthy', version: '1.2.21', uptime: 60 }
      : { data: { sources: [{ kernel: 'xray', url: 'vless://id@example.com:443' }], kernels: [
        { type: 'sing-box', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
        { type: 'xray', detected: true, monitored: true, accessible: true, nodesCount: 1, configPaths: ['/etc/xray/config.json'] },
        { type: 'v2ray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
      ] } }), { status: 200 });
  }) as typeof fetch });
  const service = new NodeAggregationService(repository, client, state, { now: () => clock, statusProbeTimeoutMs: 10 });
  return {
    state, repository, client,
    async probe(next?: typeof failure) {
      failure = next;
      clock += 1_000;
      return service.getClusterStatus({ forceRefresh: true });
    },
    async setup() {
      await repository.save([{ id: 'node-a', name: 'A', host: 'agent.example', secret: 'secret', kernels: [{ type: 'xray' }], location: 'HK', enabled: true }]);
    },
  };
}

describe('node heartbeat health', () => {
  it('reports a single timeout as fluctuating and retains the last valid runtime data', async () => {
    const fixture = heartbeatFixture();
    await fixture.setup();
    const healthy = await fixture.probe();
    const timedOut = await fixture.probe('timeout');
    expect(timedOut.nodes[0]).toMatchObject({
      health: 'fluctuating', online: true, consecutiveFailures: 1, consecutiveSuccesses: 0,
      error: '请求超时', lastError: '请求超时', lastErrorAt: '2026-09-24T00:00:02.000Z',
      version: '1.2.21', uptime: 60, nodesCount: 1, kernels: healthy.nodes[0]!.kernels,
    });
    expect(timedOut.onlineNodes).toBe(1);
  });

  it('escalates persistent failures at three and five probes and recovers only after two successes', async () => {
    const fixture = heartbeatFixture();
    await fixture.setup();
    await fixture.probe();
    const sequence = [];
    for (let index = 0; index < 5; index++) {
      const status = await fixture.probe('connection');
      sequence.push([status.nodes[0]!.health, status.nodes[0]!.consecutiveFailures, status.onlineNodes]);
    }
    expect(sequence).toEqual([
      ['fluctuating', 1, 1], ['fluctuating', 2, 1], ['abnormal', 3, 1], ['abnormal', 4, 1], ['offline', 5, 0],
    ]);
    const recovering = await fixture.probe();
    expect(recovering.nodes[0]).toMatchObject({ health: 'offline', online: false, consecutiveSuccesses: 1, error: '连接失败: connection refused' });
    const recovered = await fixture.probe();
    expect(recovered.nodes[0]).toMatchObject({
      health: 'online', online: true, consecutiveFailures: 0, consecutiveSuccesses: 2,
      lastError: '连接失败: connection refused', lastErrorAt: '2026-09-24T00:00:06.000Z',
    });
    expect(recovered.nodes[0]!.error).toBeUndefined();
  });

  it('does not accumulate intermittent failures and keeps an interrupted recovery alert active', async () => {
    const fixture = heartbeatFixture();
    await fixture.setup();
    await fixture.probe();
    for (let index = 0; index < 6; index++) {
      const failed = await fixture.probe('connection');
      expect(failed.nodes[0]).toMatchObject({ health: 'fluctuating', consecutiveFailures: 1 });
      const recovering = await fixture.probe();
      expect(recovering.nodes[0]).toMatchObject({ health: 'fluctuating', consecutiveFailures: 0, consecutiveSuccesses: 1 });
      expect(recovering.nodes[0]!.error).toBeDefined();
    }
    expect((await fixture.probe()).nodes[0]).toMatchObject({ health: 'online', consecutiveSuccesses: 2 });
    for (let index = 0; index < 5; index++) await fixture.probe('connection');
    await fixture.probe();
    const interrupted = await fixture.probe('connection');
    expect(interrupted.nodes[0]).toMatchObject({ health: 'offline', online: false, consecutiveFailures: 1, consecutiveSuccesses: 0 });
    expect((await fixture.probe()).nodes[0]!.health).toBe('offline');
    expect((await fixture.probe()).nodes[0]!.health).toBe('online');
  });

  it('preserves the latest failure reason and time after recovery and a process restart', async () => {
    const fixture = heartbeatFixture();
    await fixture.setup();
    await fixture.probe('timeout');
    await fixture.probe();
    await fixture.probe();
    const restarted = new NodeAggregationService(fixture.repository, fixture.client, fixture.state);
    const status = await restarted.getClusterStatus();
    expect(status.nodes[0]).toMatchObject({ health: 'online', lastError: '请求超时', lastErrorAt: '2026-09-24T00:00:01.000Z' });
    expect(status.nodes[0]!.error).toBeUndefined();
  });

  it('loads failure history written by older releases without inventing a failure time', async () => {
    const fixture = heartbeatFixture();
    await fixture.setup();
    await fixture.state.set('node-last-error/node-a', '连接失败: old incident');
    const status = await fixture.probe();
    expect(status.nodes[0]).toMatchObject({ health: 'online', lastError: '连接失败: old incident' });
    expect(status.nodes[0]!.lastErrorAt).toBeUndefined();
    expect(status.nodes[0]!.error).toBeUndefined();
  });
});
