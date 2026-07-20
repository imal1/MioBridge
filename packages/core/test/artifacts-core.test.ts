import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ArtifactService, MioBridgeCore, createRuntimePaths, createStateStore,
  type CoreLogger, type RemoteSourceCollector,
} from '../src/index.js';

const logger: CoreLogger = { debug() {}, info() {}, warn() {}, error() {} };
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'miobridge-core-artifacts-')); roots.push(root);
  const config = { staticDir: join(root, 'www'), logDir: join(root, 'log'), backupDir: join(root, 'backup'), clashFilename: 'clash.yaml' };
  return { root, config };
}

describe('ArtifactService', () => {
  it('writes exact raw/Base64/Clash bytes, preserves source order, and creates a deterministic backup', async () => {
    const { config } = await setup();
    const local = 'vless://id@local.example:443#local';
    const remote = 'trojan://secret@remote.example:443#remote';
    const service = new ArtifactService({
      config, logger, now: () => new Date('2026-07-12T10:11:12.000Z'),
      local: { isAvailable: async () => true, extractNodeUrls: async () => [`\u001b[32m${local}\u001b[0m`] },
      remote: { collectRemoteNodeSources: async () => ({ sources: [{ url: remote, kernel: 'xray', nodeId: 'r1', location: '香港' }], errors: ['partial'] }) },
      clash: { checkHealth: async () => true, convertToClashByContent: async content => `proxies:\n${content}\n` },
    });
    const result = await service.updateSubscription();
    const raw = await readFile(join(config.staticDir, 'raw.txt'), 'utf8');
    const encoded = await readFile(join(config.staticDir, 'subscription.txt'), 'utf8');
    expect(raw).toBe(`${local}\n${remote}`);
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(raw);
    expect(await readFile(join(config.staticDir, 'clash.yaml'), 'utf8')).toContain('proxies:');
    expect(result.backupCreated).toBe(join(config.backupDir, 'subscription_2026-07-12T10-11-12.txt'));
    expect(await readFile(result.backupCreated, 'utf8')).toBe(encoded);
    expect(result.warnings).toEqual(['节点: partial']);
  });

  it('keeps raw artifacts on Clash failure and never replaces old files on total source failure', async () => {
    const { config } = await setup();
    const usable = 'vless://id@usable.example:443#usable';
    const failingClash = new ArtifactService({ config, logger,
      local: { isAvailable: async () => true, extractNodeUrls: async () => [usable] },
      remote: { collectRemoteNodeSources: async () => ({ sources: [], errors: [] }) },
      clash: { checkHealth: async () => false, convertToClashByContent: async () => '' },
    });
    expect((await failingClash.updateSubscription()).clashGenerated).toBe(false);
    expect(await readFile(join(config.staticDir, 'raw.txt'), 'utf8')).toBe(usable);
    await writeFile(join(config.staticDir, 'raw.txt'), 'old-raw');
    await writeFile(join(config.staticDir, 'subscription.txt'), 'old-subscription');
    const failedRemote: RemoteSourceCollector = { collectRemoteNodeSources: async () => { throw new Error('remote failed'); } };
    const totalFailure = new ArtifactService({ config, logger,
      local: { isAvailable: async () => true, extractNodeUrls: async () => { throw new Error('local failed'); } },
      remote: failedRemote, clash: { checkHealth: async () => true, convertToClashByContent: async () => '' },
    });
    await expect(totalFailure.updateSubscription()).rejects.toThrow('没有找到有效的代理URL');
    expect(await readFile(join(config.staticDir, 'raw.txt'), 'utf8')).toBe('old-raw');
    expect(await readFile(join(config.staticDir, 'subscription.txt'), 'utf8')).toBe('old-subscription');
  });

  it('publishes every unique kernel source from multiple managed nodes into all three artifacts', async () => {
    const { config } = await setup();
    const sources = ['node-a', 'node-b'].flatMap((nodeId, nodeIndex) =>
      (['sing-box', 'xray', 'v2ray'] as const).map((kernel, kernelIndex) => ({
        url: `vless://${nodeIndex}${kernelIndex}@${kernel}.example:443#${nodeId}-${kernel}`,
        kernel,
        nodeId,
        location: nodeIndex === 0 ? '香港' : '日本',
      })),
    );
    let clashInput = '';
    const service = new ArtifactService({
      config, logger,
      local: { isAvailable: async () => false, extractNodeUrls: async () => [] },
      remote: { collectRemoteNodeSources: async () => ({ sources, errors: [] }) },
      clash: {
        checkHealth: async () => true,
        convertToClashByContent: async content => { clashInput = content; return `proxies:\n${content}\n`; },
      },
    });

    const result = await service.updateSubscription();
    const raw = await readFile(join(config.staticDir, 'raw.txt'), 'utf8');
    const encoded = await readFile(join(config.staticDir, 'subscription.txt'), 'utf8');
    expect(result.nodesCount).toBe(6);
    expect(raw.split('\n')).toHaveLength(6);
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(raw);
    for (const source of sources) {
      expect(raw).toContain(source.url);
      expect(decodeURIComponent(clashInput)).toContain(source.nodeId);
      expect(decodeURIComponent(clashInput)).toContain(source.kernel);
    }
    expect(await readFile(join(config.staticDir, 'clash.yaml'), 'utf8')).toContain('proxies:');
  });
});

describe('MioBridgeCore', () => {
  it('composes injected metadata, config, state, generation, and status without framework globals', async () => {
    const { root } = await setup();
    const paths = createRuntimePaths({ platformBaseDir: root, env: {} });
    await mkdir(paths.dataDir, { recursive: true });
    const mihomo = {
      checkHealth: async () => true, getVersion: async () => ({ version: '1.2.3' }),
      convertToClashByContent: async () => 'proxies:\n  - name: usable\n',
    };
    const core = new MioBridgeCore({ paths, state: createStateStore({ paths }), logger,
      metadata: { version: '9.8.7', gitCommit: 'abc123', buildTime: '2026-07-12T00:00:00Z' },
      local: { isAvailable: async () => true, extractNodeUrls: async () => ['vless://id@usable.example:443#usable'] },
      remote: { collectRemoteNodeSources: async () => ({ sources: [], errors: [] }) }, mihomo, uptime: () => 42,
    });
    await core.updateSubscription();
    const status = await core.getStatus();
    expect(core.config.getAppVersion()).toBe('9.8.7');
    expect(status).toMatchObject({ subscriptionExists: true, clashExists: true, rawExists: true, nodesCount: 1, mihomoAvailable: true, mihomoVersion: '1.2.3', uptime: 42, version: '9.8.7', gitCommit: 'abc123' });
    await writeFile(join(paths.logDir, 'combined.log'), '2026-07-12T00:00:00Z INFO ready\n2026-07-12T00:00:01Z ERROR failed\n');
    expect((await core.getLocalLogs({ level: 'error' })).entries.map(entry => entry.content)).toEqual(['2026-07-12T00:00:01Z ERROR failed']);
    const metrics = await core.getMetricsSnapshot();
    expect(metrics).toMatchObject({ version: '9.8.7', uptime: 42, proxies: 1, mihomoAvailable: true, artifacts: { raw: { exists: true }, subscription: { exists: true }, clash: { exists: true } }, lastGeneration: { status: 'success' } });
  });
});
