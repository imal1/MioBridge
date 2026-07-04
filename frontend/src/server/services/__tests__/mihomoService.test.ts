import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const TEST_CONFIG_DIR = '/tmp/miobridge-mihomo-service-test';

async function getTestMihomoService() {
  vi.stubEnv('MIOBRIDGE_CONFIG_DIR', TEST_CONFIG_DIR);
  vi.stubEnv('MIOBRIDGE_MIHOMO_PATH', `${TEST_CONFIG_DIR}/bin/mihomo`);
  vi.resetModules();
  const { MihomoService } = await import('../mihomoService');
  return MihomoService.getInstance();
}

describe('MihomoService Vercel-compatible fallback', () => {
  beforeEach(async () => {
    const fs = await import('fs-extra');
    await fs.remove(TEST_CONFIG_DIR);
  });

  afterEach(async () => {
    const fs = await import('fs-extra');
    await fs.remove(TEST_CONFIG_DIR);
    vi.unstubAllEnvs();
  });

  it('should generate Clash YAML even when mihomo and yq binaries are unavailable', async () => {
    const service = await getTestMihomoService();
    const content = 'vless://00000000-0000-4000-8000-000000000001@example.com:443?type=tcp&security=tls#vercel-node';

    expect(await service.ensureMihomoAvailable()).toBe(false);

    const yaml = await service.convertToClashByContent(content);
    expect(yaml).toContain('proxies:');
    expect(yaml).toContain('name: vercel-node');
    expect(yaml).toContain('type: vless');
    expect(yaml).toContain('proxy-groups:');
  });
});
