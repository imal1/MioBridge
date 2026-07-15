import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AgentClient, NodeAggregationService, NodeRepository, type NodeConfig, type StateStore } from '../../src/index.js';

function memoryStore(initial: string | null): StateStore {
  let value = initial;
  return { kind: 'file', get: async () => value, set: async (_key, next) => { value = next; }, del: async () => { value = null; }, withLock: async (_key, fn) => fn() };
}

const node: NodeConfig = { id: 'node-a', name: 'A', host: 'agent.example', port: 3001, secret: 'secret', kernels: [{ type: 'xray' }], location: 'HK', enabled: true };
const kernels = [
  { type: 'sing-box', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
  { type: 'xray', detected: true, monitored: true, accessible: true, nodesCount: 1, configPaths: ['/etc/xray/config.json'] },
  { type: 'v2ray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
];

describe('node core services', () => {
  it('preserves the Agent HMAC payload and headers', () => {
    const client = new AgentClient({ now: () => 1234 });
    const headers = client.sign(node, 'GET', '/api/status');
    expect(headers).toEqual({ 'X-Node-Id': 'node-a', 'X-Timestamp': '1234', 'X-Signature': createHmac('sha256', 'secret').update('1234\nGET\n/api/status\n').digest('hex') });
    expect(client.sign({ ...node, host: '127.0.0.1' }, 'GET', '/api/status')).toEqual({});
  });

  it('reads nodes.yaml directly and filters disabled nodes', async () => {
    const repository = new NodeRepository(memoryStore(`nodes:\n  - id: node-a\n    name: A\n    host: example\n    secret: secret\n    kernels:\n      - type: xray\n    location: HK\n    enabled: true\n  - id: off\n    name: Off\n    host: off\n    secret: x\n    kernels: []\n    location: HK\n    enabled: false\n`));
    expect((await repository.list()).map(n => n.id)).toEqual(['node-a']);
    expect((await repository.list({ enabledOnly: false })).map(n => n.id)).toEqual(['node-a', 'off']);
  });

  it('adds and removes a typed local node without changing child nodes', async () => {
    const store = memoryStore(`nodes:\n  - id: node-a\n    name: A\n    host: example\n    secret: secret\n    kernels:\n      - type: xray\n    location: HK\n    enabled: true\n`);
    const repository = new NodeRepository(store);
    await repository.configureLocalNode(true);
    expect(await repository.isLocalNodeConfigured()).toBe(true);
    expect(await repository.list()).toMatchObject([
      { id: 'local', kind: 'local', host: '127.0.0.1', kernels: [{ type: 'sing-box' }] },
      { id: 'node-a', kind: 'child' },
    ]);
    await repository.configureLocalNode(false);
    expect((await repository.list()).map(item => item.id)).toEqual(['node-a']);
  });

  it('includes a configured local monitor while keeping it out of Agent requests', async () => {
    const repository = new NodeRepository(memoryStore(`nodes:\n  - id: local\n    kind: local\n    name: 本机节点\n    host: 127.0.0.1\n    kernels:\n      - type: sing-box\n    location: 本机\n    enabled: true\n  - id: node-a\n    name: A\n    host: agent.example\n    secret: secret\n    kernels:\n      - type: xray\n    location: HK\n    enabled: true\n`));
    const requests: string[] = [];
    const client = new AgentClient({ fetch: (async (url: string | URL | Request) => {
      requests.push(String(url));
      return new Response(JSON.stringify({ data: { kernels, sources: [{ kernel: 'xray', url: 'vless://id@example.com:443' }] } }), { status: 200 });
    }) as typeof fetch });
    const localStatus = {
      nodeId: 'local', name: '本机节点', kind: 'local' as const, configuredKernels: [{ type: 'sing-box' as const }],
      kernels, location: '本机', online: true, nodesCount: 2,
    };
    const cluster = await new NodeAggregationService(repository, client, { status: async () => localStatus }).getClusterStatus();
    expect(cluster).toMatchObject({ totalNodes: 2, onlineNodes: 2, localNodes: 1, childNodes: 1, totalProxies: 3 });
    expect(cluster.nodes[0]).toEqual({ ...localStatus, listener: { deployed: true, listening: true } });
    expect(requests.every(url => !url.includes('127.0.0.1'))).toBe(true);
  });

  it('aggregates valid sources and keeps partial failures redacted to node identity', async () => {
    const repository = new NodeRepository(memoryStore(`nodes:\n  - id: node-a\n    name: A\n    host: agent.example\n    port: 3001\n    secret: secret\n    kernels:\n      - type: xray\n    location: HK\n    enabled: true\n  - id: bad\n    name: Bad\n    host: bad.example\n    secret: dont-print-me\n    kernels:\n      - type: xray\n    location: US\n    enabled: true\n`));
    const client = new AgentClient({ fetch: (async (url: string | URL | Request) => {
      if (String(url).includes('bad.example')) throw new Error('offline');
      return new Response(JSON.stringify({ data: { kernels, sources: [{ kernel: 'xray', url: 'vless://id@example.com:443' }] } }), { status: 200 });
    }) as typeof fetch });
    const result = await new NodeAggregationService(repository, client).collectRemoteNodeSources();
    expect(result.sources).toEqual([{ kernel: 'xray', url: 'vless://id@example.com:443', nodeId: 'node-a', location: 'HK' }]);
    expect(result.errors).toEqual(['节点 Bad (bad): offline']);
    expect(JSON.stringify(result)).not.toContain('dont-print-me');
  });

  it.each([
    ['unmonitored', { type: 'sing-box', detected: true, monitored: false, accessible: true, nodesCount: 1, configPaths: [] }],
    ['inaccessible', { type: 'sing-box', detected: true, monitored: true, accessible: false, nodesCount: 1, configPaths: [] }],
  ])('rejects a source from an %s kernel instead of filtering it', async (_label, invalidKernel) => {
    const repository = new NodeRepository(memoryStore(`nodes:\n  - id: node-a\n    name: A\n    host: agent.example\n    secret: secret\n    kernels:\n      - type: xray\n    location: HK\n    enabled: true\n`));
    const responseKernels = kernels.map(kernel => kernel.type === 'sing-box' ? invalidKernel : kernel);
    const client = new AgentClient({ fetch: (async () => new Response(JSON.stringify({ data: {
      kernels: responseKernels, sources: [{ kernel: 'sing-box', url: 'vless://id@example.com:443' }],
    } }), { status: 200 })) as typeof fetch });
    const result = await new NodeAggregationService(repository, client).collectRemoteNodeSources();
    expect(result.sources).toEqual([]);
    expect(result.errors[0]).toContain('未监控或不可访问');
  });
});
