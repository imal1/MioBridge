import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
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

  it('configures the default local node as a plain node profile', async () => {
    const store = memoryStore(`nodes:\n  - id: node-a\n    name: A\n    host: example\n    secret: secret\n    kernels:\n      - type: xray\n    location: HK\n    enabled: true\n`);
    const repository = new NodeRepository(store);
    await repository.configureLocalNode(true);
    expect(await repository.isLocalNodeConfigured()).toBe(true);
    expect(await repository.list()).toMatchObject([
      { id: 'local', name: '本机节点', host: '127.0.0.1', kernels: [
        { type: 'sing-box' }, { type: 'xray' }, { type: 'v2ray' },
      ], location: '本机', enabled: true },
      { id: 'node-a' },
    ]);
    // 重复启用是幂等的，且不会覆盖用户对档案的后续修改。
    await repository.update('local', current => ({ ...current, name: '主控机', location: 'CN' }));
    await repository.configureLocalNode(true);
    expect((await repository.list())[0]).toMatchObject({ id: 'local', name: '主控机', location: 'CN' });
    await repository.configureLocalNode(false);
    expect((await repository.list()).map(item => item.id)).toEqual(['node-a']);
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

  it('merges every kernel source from multiple enabled child nodes', async () => {
    const repository = new NodeRepository(memoryStore(`nodes:\n  - id: one\n    name: One\n    host: one.example\n    secret: one\n    kernels: [{ type: sing-box }, { type: xray }, { type: v2ray }]\n    location: HK\n    enabled: true\n  - id: two\n    name: Two\n    host: two.example\n    secret: two\n    kernels: [{ type: sing-box }, { type: xray }, { type: v2ray }]\n    location: US\n    enabled: true\n`));
    const client = new AgentClient({ fetch: (async (url: string | URL | Request) => {
      const host = String(url).includes('one.example') ? 'one' : 'two';
      const responseKernels = ['sing-box', 'xray', 'v2ray'].map(type => ({
        type, detected: true, monitored: true, accessible: true, nodesCount: 1, configPaths: [`/etc/${type}/config.json`],
      }));
      const sources = ['sing-box', 'xray', 'v2ray'].map((kernel, index) => ({
        kernel, url: `vless://id-${host}-${index}@${host}-${index}.example:443`,
      }));
      return new Response(JSON.stringify({ data: { kernels: responseKernels, sources } }), { status: 200 });
    }) as typeof fetch });
    const result = await new NodeAggregationService(repository, client).collectRemoteNodeSources();
    expect(result.errors).toEqual([]);
    expect(result.sources).toHaveLength(6);
    expect(new Set(result.sources.map(source => `${source.nodeId}:${source.kernel}`))).toEqual(new Set([
      'one:sing-box', 'one:xray', 'one:v2ray', 'two:sing-box', 'two:xray', 'two:v2ray',
    ]));
  });

  it('reconciles a bootstrap-installed Agent when it becomes reachable', async () => {
    const repository = new NodeRepository(memoryStore(`nodes:\n  - id: local\n    name: 本机节点\n    host: 127.0.0.1\n    secret: secret\n    kernels:\n      - type: xray\n    location: 本机\n    enabled: true\n    agent:\n      deployed: false\n      version: ""\n      status: not_deployed\n      lastDeploy: ""\n      port: 3001\n`));
    const client = new AgentClient({ fetch: (async (url: string | URL | Request) => {
      const sources = [{ kernel: 'xray', url: 'vless://id@example.com:443' }];
      return new Response(JSON.stringify({ data: { version: '1.2.1', uptime: 10, kernels, sources } }), { status: 200 });
    }) as typeof fetch });
    const status = await new NodeAggregationService(repository, client).getClusterStatus();
    expect(status.nodes[0]?.agent).toMatchObject({ deployed: true, status: 'running', version: '1.2.1' });
    expect((await repository.list())[0]?.agent).toMatchObject({ deployed: true, status: 'running', version: '1.2.1' });
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

  describe('Agent kernel status validation', () => {
    it('tolerates a benign unknown field but strips it from the returned status', () => {
      // 服务端/Agent 新增一个向后兼容的字段不应该让整份状态被判为无效。
      const extended = kernels.map(kernel =>
        kernel.type === 'xray' ? { ...kernel, releaseChannel: 'stable' } : kernel);
      const result = new AgentClient().validateKernelStatuses(extended);
      expect(result.map(item => item.type)).toEqual(['sing-box', 'xray', 'v2ray']);
      // 但未知字段必须被剥掉，否则会顺着 NodeStatus.kernels 出现在 API 响应里。
      expect(result[1]).not.toHaveProperty('releaseChannel');
      expect(JSON.stringify(result)).not.toContain('releaseChannel');
    });

    it.each([
      ['sshPassword', 'hunter2'],
      ['privateKey', 'BEGIN OPENSSH PRIVATE KEY'],
      ['agentSecret', 'shared-secret'],
      ['apiToken', 'token'],
    ])('rejects the whole payload when a kernel status carries %s', (key, value) => {
      const leaking = kernels.map(kernel =>
        kernel.type === 'xray' ? { ...kernel, [key]: value } : kernel);
      expect(() => new AgentClient().validateKernelStatuses(leaking))
        .toThrow('Agent 返回了无效的内核状态');
    });

    it('accepts the optional binary path and rejects a non-string one', () => {
      const withPath = kernels.map(kernel =>
        kernel.type === 'xray' ? { ...kernel, binaryPath: '/usr/local/bin/xray' } : kernel);
      expect(new AgentClient().validateKernelStatuses(withPath)[1]?.binaryPath).toBe('/usr/local/bin/xray');

      const malformed = kernels.map(kernel =>
        kernel.type === 'xray' ? { ...kernel, binaryPath: 42 } : kernel);
      expect(() => new AgentClient().validateKernelStatuses(malformed))
        .toThrow('Agent 返回了无效的内核状态');
    });
  });

  it('keeps the last error visible after the node recovers, across a restart', async () => {
    const nodesYaml = `nodes:\n  - id: node-a\n    name: A\n    host: agent.example\n    secret: secret\n    kernels:\n      - type: xray\n    location: HK\n    enabled: true\n`;
    const entries = new Map<string, string>();
    const keyedStore: StateStore = {
      kind: 'file',
      get: async key => entries.get(key) ?? null,
      set: async (key, value) => { entries.set(key, value); },
      del: async key => { entries.delete(key); },
      withLock: async (_key, fn) => fn(),
    };
    const offline = new AgentClient({ fetch: (async () => { throw new Error('offline'); }) as typeof fetch });
    const online = new AgentClient({ fetch: (async () => new Response(
      JSON.stringify({ data: { kernels, sources: [{ kernel: 'xray', url: 'vless://id@example.com:443' }] } }),
      { status: 200 },
    )) as typeof fetch });

    const failing = await new NodeAggregationService(new NodeRepository(memoryStore(nodesYaml)), offline, keyedStore).getClusterStatus();
    expect(failing.nodes[0]?.error).toContain('offline');
    expect(failing.nodes[0]?.lastError).toContain('offline');

    // 全新实例代表进程重启：内存缓存已空，最近错误只能来自持久化存储。
    const recovered = await new NodeAggregationService(new NodeRepository(memoryStore(nodesYaml)), online, keyedStore).getClusterStatus();
    expect(recovered.nodes[0]?.online).toBe(true);
    expect(recovered.nodes[0]?.error).toBeUndefined();
    expect(recovered.nodes[0]?.lastError).toContain('offline');
  });

  it('surfaces detected-but-unmonitored kernels as adoption candidates', async () => {
    const repository = new NodeRepository(memoryStore(`nodes:\n  - id: node-a\n    name: A\n    host: agent.example\n    secret: secret\n    kernels:\n      - type: xray\n    location: HK\n    enabled: true\n`));
    const reported = [
      { type: 'sing-box', detected: true, monitored: false, accessible: true, nodesCount: 0, configPaths: [] },
      { type: 'xray', detected: true, monitored: true, accessible: true, nodesCount: 0, configPaths: ['/etc/xray/config.json'] },
      { type: 'v2ray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
    ];
    const client = new AgentClient({ fetch: (async () => new Response(
      JSON.stringify({ data: { version: '1.2.14', kernels: reported, sources: [] } }), { status: 200 },
    )) as typeof fetch });
    const status = await new NodeAggregationService(repository, client).getClusterStatus();
    // sing-box 已装未纳管 → 候选；xray 已纳管、v2ray 未检测 → 排除。
    expect(status.nodes[0]?.adoptableKernels).toEqual(['sing-box']);
  });

  it('collapses concurrent and rapid cluster-status polls into a single fan-out', async () => {
    const repository = new NodeRepository(memoryStore(`nodes:\n  - id: node-a\n    name: A\n    host: agent.example\n    secret: secret\n    kernels:\n      - type: xray\n    location: HK\n    enabled: true\n`));
    let calls = 0;
    const client = new AgentClient({ fetch: (async () => { calls++; return new Response(
      JSON.stringify({ data: { kernels, sources: [{ kernel: 'xray', url: 'vless://id@example.com:443' }] } }),
      { status: 200 },
    ); }) as typeof fetch });
    let clock = 1_000;
    const service = new NodeAggregationService(repository, client, undefined, { statusTtlMs: 5_000, now: () => clock });

    // 多个端点同时轮询：in-flight 去重把它们折叠成一次扇出。
    // 单节点每轮 = status() + collectSources() = 2 次 fetch。
    await Promise.all([service.getClusterStatus(), service.getClusterStatus(), service.getClusterStatus()]);
    expect(calls).toBe(2);

    // TTL 内再轮询：命中缓存，零扇出。
    await service.getClusterStatus();
    expect(calls).toBe(2);

    // forceRefresh 绕过缓存，重新扇出。
    await service.getClusterStatus({ forceRefresh: true });
    expect(calls).toBe(4);

    // TTL 过期后：stale-while-revalidate 立刻回旧快照，后台再扇出刷新。
    clock += 6_000;
    await service.getClusterStatus();
    await vi.waitFor(() => expect(calls).toBe(6));
  });

  it('serves a stale snapshot immediately instead of blocking on a hung fan-out', async () => {
    const repository = new NodeRepository(memoryStore(`nodes:\n  - id: node-a\n    name: A\n    host: agent.example\n    secret: secret\n    kernels:\n      - type: xray\n    location: HK\n    enabled: true\n`));
    let calls = 0;
    let releaseHung: () => void = () => {};
    const client = new AgentClient({ fetch: (async () => {
      calls++;
      // 冷启动的 status()+collectSources() 立刻返回填满缓存；之后的后台刷新挂起，
      // 模拟一个不可达/慢节点——过期后的读取绝不能被它拖住。
      if (calls > 2) await new Promise<void>(resolve => { releaseHung = resolve; });
      return new Response(
        JSON.stringify({ data: { kernels, sources: [{ kernel: 'xray', url: 'vless://id@example.com:443' }] } }),
        { status: 200 },
      );
    }) as typeof fetch });
    let clock = 0;
    const service = new NodeAggregationService(repository, client, undefined, { statusTtlMs: 1_000, now: () => clock });

    await service.getClusterStatus();
    expect(calls).toBe(2);

    clock += 2_000; // 过期
    const startedAt = Date.now();
    const stale = await service.getClusterStatus();
    // 立刻拿到旧快照，没有等待挂起的后台刷新。
    expect(stale.totalNodes).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(100);

    releaseHung(); // 放行后台刷新，避免测试留下悬挂的 Promise。
  });
});
