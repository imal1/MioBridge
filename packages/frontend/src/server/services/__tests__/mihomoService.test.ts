import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import YAML from 'yaml';
import { buildClashSubscription, type CollectedProxySource } from '../proxySources';

const TEST_CONFIG_DIR = '/tmp/miobridge-mihomo-service-test';

async function getTestMihomoService() {
  process.env.MIOBRIDGE_CONFIG_DIR = TEST_CONFIG_DIR;
  process.env.MIOBRIDGE_MIHOMO_PATH = `${TEST_CONFIG_DIR}/bin/mihomo`;
  process.env.TMPDIR = `${TEST_CONFIG_DIR}/tmp`;
  const { MihomoService } = await import('../mihomoService');
  const service = MihomoService.getInstance();
  const fs = await import('fs-extra');
  const path = await import('path');
  await fs.ensureDir(path.dirname((service as unknown as { configPath: string }).configPath));
  return service;
}

async function writeFakeMihomo() {
  const fs = await import('fs-extra');
  const binaryPath = `${TEST_CONFIG_DIR}/bin/mihomo`;
  await fs.ensureDir(`${TEST_CONFIG_DIR}/bin`);
  await fs.ensureDir(`${TEST_CONFIG_DIR}/mihomo`);
  await fs.writeFile(binaryPath, [
    '#!/bin/sh',
    'for arg in "$@"; do',
    '  if [ "$arg" = "-v" ]; then echo "Mihomo v-test"; exit 0; fi',
    '  if [ "$arg" = "-t" ]; then touch "$HOME/write-check" && exit 0; exit 3; fi',
    'done',
    'echo "ok"',
    '',
  ].join('\n'));
  await fs.chmod(binaryPath, 0o755);
}

describe('MihomoService binary-backed conversion', () => {
  beforeEach(async () => {
    const fs = await import('fs-extra');
    await fs.remove(TEST_CONFIG_DIR);
    await writeFakeMihomo();
  });

  afterEach(async () => {
    const fs = await import('fs-extra');
    await fs.remove(TEST_CONFIG_DIR);
    delete process.env.MIOBRIDGE_CONFIG_DIR;
    delete process.env.MIOBRIDGE_MIHOMO_PATH;
    delete process.env.TMPDIR;
  });

  it('should require mihomo and validate generated Clash YAML with the binary', async () => {
    const service = await getTestMihomoService();
    const content = 'vless://00000000-0000-4000-8000-000000000001@example.com:443?type=tcp&security=tls#vercel-node';

    expect(await service.ensureMihomoAvailable()).toBe(true);
    expect(await service.getVersion()).toMatchObject({ version: 'v-test' });

    const yaml = await service.convertToClashByContent(content);
    const fs = await import('fs-extra');
    expect(await fs.pathExists(`${TEST_CONFIG_DIR}/tmp/miobridge-mihomo/write-check`)).toBe(true);
    expect(yaml).toContain('proxies:');
    expect(yaml).toContain('name: vercel-node');
    expect(yaml).toContain('type: vless');
    expect(yaml).toContain('proxy-groups:');
  }, 10_000);

  it('uses every final collision-safe proxy name in generated proxy groups', async () => {
    const service = await getTestMihomoService();
    const sources: CollectedProxySource[] = [
      { url: 'vless://id-a@a.example:443#node', kernel: 'sing-box', nodeId: 'hk-a', location: '香港' },
      { url: 'vless://id-b@b.example:443#node', kernel: 'xray', nodeId: 'hk-b', location: '香港' },
    ];
    const result = YAML.parse(await service.convertToClashByContent(buildClashSubscription(sources)));
    const finalNames = result.proxies.map((proxy: { name: string }) => proxy.name);

    expect(finalNames).toEqual([
      '香港 node [vless://id-a@a.example:443#node]',
      '香港 node [vless://id-b@b.example:443#node]',
    ]);
    const mainSelect = result['proxy-groups'].find((item: { name: string }) => item.name === '🚀 节点选择');
    expect(mainSelect.proxies.slice(-finalNames.length)).toEqual(finalNames);
    for (const group of result['proxy-groups'].filter((item: { type: string }) => item.type !== 'select')) {
      expect(group.proxies).toEqual(finalNames);
    }
  }, 10_000);
});
