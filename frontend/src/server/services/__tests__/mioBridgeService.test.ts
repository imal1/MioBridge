import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import type { CollectedProxySource } from '../proxySources';
import { MioBridgeService } from '../mioBridgeService';
import { logger } from '../../utils/logger';

const TEST_DIR = '/tmp/miobridge-update-subscription-test';
const testConfig = {
  staticDir: path.join(TEST_DIR, 'www'),
  logDir: path.join(TEST_DIR, 'logs'),
  backupDir: path.join(TEST_DIR, 'backups'),
  clashFilename: 'clash.yaml',
};

function remoteSource(url: string, nodeId = 'remote-ok'): CollectedProxySource {
  return { url, kernel: 'xray', nodeId, location: '香港' };
}

function setupService(options: {
  localAvailable?: () => Promise<boolean>;
  localCollect?: () => Promise<{ urls: string[]; errors: string[] }>;
  remoteCollect?: () => Promise<{ sources: CollectedProxySource[]; errors: string[] }>;
  mihomoHealth?: () => Promise<boolean>;
  convert?: (content: string) => Promise<string>;
}) {
  return new MioBridgeService({
    updateConfig: testConfig,
    singBoxService: {
      checkSingBoxAvailable: options.localAvailable ?? (async () => true),
      getAllConfigUrls: options.localCollect ?? (async () => ({ urls: [], errors: [] })),
    },
    mihomoService: {
      checkHealth: options.mihomoHealth ?? (async () => true),
      convertToClashByContent: options.convert ?? (async () => 'proxies:\n  - name: usable\n'),
      getVersion: async () => null,
    },
    collectRemoteSources: options.remoteCollect ?? (async () => ({ sources: [], errors: [] })),
  });
}

async function readArtifacts() {
  const raw = await fs.readFile(path.join(testConfig.staticDir, 'raw.txt'), 'utf8');
  const subscription = await fs.readFile(path.join(testConfig.staticDir, 'subscription.txt'), 'utf8');
  return { raw, subscription };
}

describe('MioBridgeService updateSubscription artifact isolation', () => {
  beforeEach(async () => {
    await fs.remove(TEST_DIR);
  });

  afterEach(async () => {
    await fs.remove(TEST_DIR);
  });

  it('writes raw and Base64 subscription before reporting unavailable Mihomo', async () => {
    const url = 'vless://id@usable.example:443#raw-name';
    let healthObservedArtifacts = false;
    const service = setupService({
      localCollect: async () => ({ urls: [url], errors: [] }),
      mihomoHealth: async () => {
        healthObservedArtifacts = await fs.pathExists(path.join(testConfig.staticDir, 'raw.txt')) &&
          await fs.pathExists(path.join(testConfig.staticDir, 'subscription.txt'));
        return false;
      },
    });

    const result = await service.updateSubscription();
    const artifacts = await readArtifacts();
    expect(healthObservedArtifacts).toBe(true);
    expect(result.success).toBe(true);
    expect(result.clashGenerated).toBe(false);
    expect(result.errors?.join('\n')).toContain('Mihomo');
    expect(artifacts.raw).toBe(url);
    expect(Buffer.from(artifacts.subscription, 'base64').toString('utf8')).toBe(artifacts.raw);
  });

  it('keeps raw artifacts when Clash conversion throws', async () => {
    const url = 'trojan://secret@usable.example:443#raw-name';
    const service = setupService({
      remoteCollect: async () => ({ sources: [remoteSource(url)], errors: [] }),
      convert: async () => { throw new Error('converter exploded'); },
    });

    const result = await service.updateSubscription();
    const artifacts = await readArtifacts();
    expect(result.clashGenerated).toBe(false);
    expect(result.errors?.join('\n')).toContain('converter exploded');
    expect(artifacts.raw).toBe(url);
    expect(Buffer.from(artifacts.subscription, 'base64').toString('utf8')).toBe(url);
  });

  it('never logs proxy URL credentials or tokens', async () => {
    const uuid = '00000000-0000-4000-8000-000000000001';
    const password = 'danger-password';
    const token = 'danger-token';
    const urls = [
      `vless://${uuid}@one.example:443?token=${token}#one`,
      `trojan://${password}@two.example:443#two`,
    ];
    const info = vi.spyOn(logger, 'info');
    const service = setupService({
      localCollect: async () => ({ urls, errors: [] }),
    });

    await service.updateSubscription();

    const logged = info.mock.calls.flat().map(String).join('\n');
    expect(logged).not.toContain(uuid);
    expect(logged).not.toContain(password);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(urls[0]);
    expect(logged).not.toContain(urls[1]);
    expect(logged).toContain('vless');
    expect(logged).toContain('sing-box');
    expect(logged).toContain('local');
  });

  it('isolates malformed VMess from Clash while retaining it in raw artifacts', async () => {
    const bad = 'vmess://this-is-not-json-but-is-long-enough';
    const good = 'vless://id@usable.example:443#good';
    let clashInput = '';
    const service = setupService({
      localCollect: async () => ({ urls: [bad, good], errors: [] }),
      convert: async content => {
        clashInput = content;
        return 'proxies:\n  - name: usable\n';
      },
    });

    const result = await service.updateSubscription();
    const artifacts = await readArtifacts();
    expect(artifacts.raw.split('\n')).toEqual([bad, good]);
    expect(clashInput).not.toContain(bad);
    expect(clashInput).toContain('usable.example');
    expect(result.warnings?.join('\n')).toContain('local');
    expect(result.warnings?.join('\n')).toContain('sing-box');
  });

  it.each([
    ['local',
      async () => { throw new Error('local top-level failed'); },
      async () => ({ sources: [remoteSource('vless://id@remote.example:443#remote')], errors: ['xray partial'] })],
    ['remote',
      async () => ({ urls: ['vless://id@local.example:443#local'], errors: ['local partial'] }),
      async () => { throw new Error('remote top-level failed'); }],
  ])('continues after %s collection throws and returns warnings', async (_side, localCollect, remoteCollect) => {
    const service = setupService({ localCollect, remoteCollect });
    const result = await service.updateSubscription();
    const artifacts = await readArtifacts();
    const clash = await fs.readFile(path.join(testConfig.staticDir, testConfig.clashFilename), 'utf8');

    expect(result.success).toBe(true);
    expect(result.warnings?.length).toBeGreaterThan(0);
    expect(artifacts.raw).toContain('://');
    expect(Buffer.from(artifacts.subscription, 'base64').toString('utf8')).toBe(artifacts.raw);
    expect(clash).toContain('proxies:');
  });

  it('does not replace old artifacts when every source collection fails', async () => {
    await fs.ensureDir(testConfig.staticDir);
    await fs.writeFile(path.join(testConfig.staticDir, 'raw.txt'), 'old-raw');
    await fs.writeFile(path.join(testConfig.staticDir, 'subscription.txt'), 'old-subscription');
    await fs.writeFile(path.join(testConfig.staticDir, testConfig.clashFilename), 'old-clash');
    let remoteCalled = false;
    const service = setupService({
      localCollect: async () => { throw new Error('local failed'); },
      remoteCollect: async () => {
        remoteCalled = true;
        throw new Error('remote failed');
      },
    });

    await expect(service.updateSubscription()).rejects.toThrow('没有找到有效的代理URL');
    expect(remoteCalled).toBe(true);
    expect(await fs.readFile(path.join(testConfig.staticDir, 'raw.txt'), 'utf8')).toBe('old-raw');
    expect(await fs.readFile(path.join(testConfig.staticDir, 'subscription.txt'), 'utf8')).toBe('old-subscription');
    expect(await fs.readFile(path.join(testConfig.staticDir, testConfig.clashFilename), 'utf8')).toBe('old-clash');
  });
});
