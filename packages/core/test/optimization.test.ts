import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthService, ArtifactService, FileStateStore, NodeRepository, PublicationBlockedError, buildClashSubscription, createRuntimePaths, nextScheduledRun, validateSchedule, ConfigService, YamlService } from '../src/index.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'miobridge-optimization-')); roots.push(root);
  const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: root } });
  return { root, paths, state: new FileStateStore(paths) };
}
describe('optimization regressions', () => {
  it('auth sessions expire, rotation invalidates them, and subscription tokens are independent', async () => {
    const { state } = await fixture(); let now = 1000;
    const auth = new AuthService(state, () => now); const config = await auth.ensure(true);
    expect(await auth.login('wrong')).toBeNull();
    expect(await auth.subscriptionAuthorized('')).toBe(false);
    expect(await auth.subscriptionAuthorized(config.admin_token)).toBe(false);
    expect(await auth.subscriptionAuthorized(config.subscription_token)).toBe(true);
    const session = await auth.login(config.admin_token);
    expect(await auth.authorized(`miobridge_session=${session}`)).toBe(true);
    expect(await auth.authorized(`miobridge_session=${session}x`)).toBe(false);
    await auth.rotate();
    expect(await auth.authorized(`miobridge_session=${session}`)).toBe(false);
    const current = await auth.ensure(); const next = await auth.login(current.admin_token);
    now += 86400001;
    expect(await auth.authorized(`miobridge_session=${next}`)).toBe(false);
    expect(await auth.subscriptionAuthorized(config.subscription_token)).toBe(true);
    await auth.rotate(true);
    expect(await auth.subscriptionAuthorized(config.subscription_token)).toBe(false);
  });
  it('legacy subscription access stays available until explicitly enabled', async () => {
    const { state } = await fixture(); const auth = new AuthService(state);
    await auth.ensure(false); expect(await auth.subscriptionAuthorized('')).toBe(true);
    await auth.enableSubscriptions(); expect(await auth.subscriptionAuthorized('')).toBe(false);
  });
  it('serializes independent file stores and never exposes a partially written document', async () => {
    const { state, paths, root } = await fixture(); const second = new FileStateStore(paths);
    await state.set('counter', '0');
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? state : second).withLock('counter', async () => {
      const value = Number(await state.get('counter')); await new Promise(resolve => setTimeout(resolve, 1)); await state.set('counter', String(value + 1));
    })));
    expect(await state.get('counter')).toBe('20');
    expect((await readdir(root)).filter(name => name.endsWith('.tmp') || name.endsWith('.lock'))).toEqual([]);
  });
  it('recovers a damaged node registry from its last valid backup', async () => {
    const { state } = await fixture(); const nodes = new NodeRepository(state);
    await nodes.configureLocalNode(true); await nodes.configureLocalNode(true);
    await state.set('nodes.yaml', 'nodes: [broken');
    expect((await nodes.list())[0]?.id).toBe('local');
  });
  it('supports cron ranges, Sunday 7, and timezone and rejects invalid schedules', () => {
    expect(nextScheduledRun('0 9-18 * * 1-5', new Date('2026-11-08T00:00:00Z'), 'Asia/Shanghai')?.toISOString()).toBe('2026-11-09T01:00:00.000Z');
    expect(nextScheduledRun('0 0 * * 7', new Date('2026-11-07T00:00:00Z'), 'UTC')?.getUTCDay()).toBe(0);
    expect(() => validateSchedule('0 25 * * *')).toThrow();
    expect(() => validateSchedule('*/0 * * * *')).toThrow();
  });
  it('keeps public artifact names fixed even with a legacy custom filename', async () => {
    const { paths, state } = await fixture();
    await state.set('config.yaml', 'subscription:\n  clash_filename: old.yaml\n');
    const config = new ConfigService(new YamlService({ paths }), paths, 'test');
    expect(config.getConfig().clashFilename).toBe('clash.yaml');
    expect(config.getSchema().some(field => field.path === 'subscription.clash_filename')).toBe(false);
  });
  it('never leaks credentials in duplicate names, including suffix collisions', () => {
    const output = buildClashSubscription(['same', 'same', 'same 2'].map((name, i) => ({ url: `trojan://password${i}@example.com:443#${name}`, kernel: 'xray', nodeId: 'r', location: 'Tokyo' })));
    const names = output.split('\n').map(line => decodeURIComponent(line.split('#')[1]!));
    expect(new Set(names).size).toBe(3); expect(names.join()).not.toContain('password');
  });
  it('blocks shrinking publication, preserves exact old bytes and allows an explicit override', async () => {
    const { state, root } = await fixture(); let count = 4; let collected = 0;
    const service = new ArtifactService({ state, config: { staticDir: root, backupDir: join(root, 'backups'), logDir: join(root, 'logs'), clashFilename: 'clash.yaml' }, logger: { debug() {}, info() {}, warn() {}, error() {} },
      local: { isAvailable: async () => false, extractNodeUrls: async () => [] },
      remote: { collectRemoteNodeSources: async () => { collected++; return { sources: Array.from({ length: count }, (_, i) => ({ url: `trojan://password${i}@example.com:443#proxy${i}`, nodeId: 'r', kernel: 'xray' as const, location: 'Tokyo' })), errors: [] }; } },
      clash: { checkHealth: async () => true, convertToClashByContent: async () => 'proxies: []' } });
    await service.updateSubscription(); const before = await readFile(join(root, 'raw.txt'), 'utf8');
    await state.del('artifact-state/sources.json'); // Upgrade from a release without source metadata.
    count = 1;
    await expect(service.updateSubscription()).rejects.toBeInstanceOf(PublicationBlockedError);
    expect(await readFile(join(root, 'raw.txt'), 'utf8')).toBe(before);
    const preflight = await service.preflight(); const calls = collected;
    const result = await service.updateSubscription({ force: true, snapshot: preflight.snapshot! });
    expect(collected).toBe(calls); expect(result.diff?.removed).toHaveLength(3);
    expect((await readFile(join(root, 'raw.txt'), 'utf8')).split('\n')).toHaveLength(1);
  });
});

it('requires an explicit consumer for every editable configuration field and delivers changes', async () => {
  const { CONFIG_CONSUMERS } = await import('../src/config/configConsumers.js');
  const { paths } = await fixture(); const config = new ConfigService(new YamlService({ paths }), paths, 'test');
  expect(config.getSchema().map(field => field.path).sort()).toEqual(Object.keys(CONFIG_CONSUMERS).sort());
  let observed = '';
  const stop = config.onChange(value => { observed = value.app?.public_base_url ?? ''; });
  config.setConfigByPath('app.public_base_url', 'https://subscriptions.example');
  expect(observed).toBe('https://subscriptions.example');
  stop();
});

it('filters notification events, retries failures, records history and supports Telegram payloads', async () => {
  const { WebhookService } = await import('../src/index.js');
  const { state } = await fixture(); let attempts = 0; let body: unknown;
  const service = new WebhookService(state, () => ({ enabled: true, url: 'https://webhook.example', events: ['node.offline'], template: 'telegram', target: '123' }),
    (async (_url, input) => { attempts++; body = JSON.parse(String(input?.body)); return new Response('', { status: attempts < 3 ? 500 : 200 }); }) as typeof fetch,
    async () => {});
  expect(await service.send('node.recovered', 'online')).toBeNull(); expect(attempts).toBe(0);
  expect(await service.send('node.offline', 'Tokyo offline')).toMatchObject({ ok: true, attempts: 3 });
  expect(body).toMatchObject({ chat_id: '123', text: '[MioBridge] node.offline: Tokyo offline' });
  expect(await state.listKeys('notifications/')).toHaveLength(1);
});

it('keeps offline server sources for 72 hours, excludes disabled servers, and limits polling load', async () => {
  const { AgentClient, NodeAggregationService } = await import('../src/index.js');
  const { state } = await fixture(); const repository = new NodeRepository(state);
  await repository.add({ id: 'tokyo', name: 'Tokyo', host: 'agent.example', secret: 'test', enabled: true, location: 'Tokyo', kernels: [{ type: 'xray' }] });
  let now = Date.now(); let offline = false; let sourceRequests = 0;
  const kernels = (['sing-box', 'xray', 'v2ray'] as const).map(type => ({ type, detected: type === 'xray', monitored: type === 'xray', accessible: type === 'xray', nodesCount: type === 'xray' ? 1 : 0, configPaths: [] }));
  const agent = new AgentClient({ fetch: (async input => {
    if (offline) throw new Error('offline');
    if (String(input).includes('/api/urls')) { sourceRequests++; return new Response(JSON.stringify({ data: { sources: [{ kernel: 'xray', url: 'vless://test@proxy.example:443#Tokyo' }], kernels } })); }
    return new Response(JSON.stringify({ status: 'healthy', version: '1.2.23' }));
  }) as typeof fetch });
  const aggregation = new NodeAggregationService(repository, agent, state, { now: () => now });
  for (let i = 0; i < 240; i++) { await aggregation.getClusterStatus({ forceRefresh: true }); now += 15000; }
  expect(sourceRequests).toBeLessThanOrEqual(15);
  offline = true; now += 3600000;
  const cached = await aggregation.collectRemoteNodeSources();
  expect(cached.sources).toHaveLength(1); expect(cached.errors.join()).toContain('缓存');
  await repository.update('tokyo', node => ({ ...node, enabled: false }));
  expect((await aggregation.collectRemoteNodeSources()).sources).toHaveLength(0);
  await repository.update('tokyo', node => ({ ...node, enabled: true })); now += 73 * 3600000;
  expect((await aggregation.collectRemoteNodeSources()).sources).toHaveLength(0);
});

it('serializes concurrent writers in separate processes without losing updates', async () => {
  const { root, state } = await fixture();
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
  const program = `import { FileStateStore, createRuntimePaths } from ${JSON.stringify(moduleUrl)};
    const store = new FileStateStore(createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: ${JSON.stringify(root)} } }));
    for (let i = 0; i < 20; i++) await store.withLock('counter', async () => {
      const n = Number(await store.get('counter') || 0);
      await new Promise(resolve => setTimeout(resolve, 1)); await store.set('counter', String(n + 1));
    });`;
  await Promise.all([1, 2].map(() => promisify(execFile)(process.execPath, ['--input-type=module', '-e', program])));
  expect(await state.get('counter')).toBe('40');
});

it('keeps the documented example valid against the current editable configuration schema', async () => {
  const { paths } = await fixture();
  const service = new ConfigService(new YamlService({ paths }), paths, 'test');
  const example = await readFile(new URL('../../../config.yaml.example', import.meta.url), 'utf8');
  expect(service.validate(example)).toMatchObject({ valid: true, issues: [] });
});
