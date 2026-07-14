import { describe, expect, it, vi } from 'vitest';
import { createRuntimePaths } from '@miobridge/core';
import { detectLinuxPlatform } from '../../src/platform/linux.js';
import { DependencySetupService } from '../../src/setup/service.js';
import { createNodeSetupAdapters } from '../../src/setup/nodeAdapters.js';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArtifactCatalog, SetupAdapters } from '../../src/setup/types.js';

const bytes = new Uint8Array([1, 2, 3]);
const artifact = { version: 'v1.2.3', url: 'https://user:secret@example.test/download?token=private', sha256: 'trusted', archive: 'binary' as const, versionArgs: ['--version'] };
const artifacts: ArtifactCatalog = { mihomo: { x64: artifact, arm64: artifact } };

function harness(overrides: Partial<SetupAdapters> = {}, executable = new Set<string>()) {
  const installed: string[] = [];
  const adapters: SetupAdapters = {
    platform: async () => ({ os: 'linux', architecture: 'x64', distro: 'debian' }),
    existsExecutable: async path => executable.has(path), probeVersion: async () => '1.2.3',
    confirm: async () => false, download: async () => bytes, sha256: async () => 'trusted', extract: async value => value,
    installAtomic: async (path, _data, validate) => { await validate(`${path}.tmp`); installed.push(path); executable.add(path); }, ...overrides,
  };
  const paths = createRuntimePaths({ env: { PATH: '/usr/bin:/opt/bin' }, platformBaseDir: '/runtime' });
  return { service: new DependencySetupService({ paths, configured: { mihomo: '/configured/mihomo' }, adapters, artifacts }), installed };
}

describe('Linux platform detection', () => {
  it('maps supported architectures and distro', () => expect(detectLinuxPlatform({ platform: 'linux', architecture: 'aarch64', osRelease: 'ID=ubuntu\n' })).toEqual({ os: 'linux', architecture: 'arm64', distro: 'ubuntu' }));
  it.each([['darwin', 'x64', 'operating system'], ['linux', 'riscv64', 'architecture']])('rejects unsupported %s/%s', (platform, architecture, message) => expect(() => detectLinuxPlatform({ platform, architecture })).toThrow(message));
});

describe('DependencySetupService', () => {
  it('reports configured, managed, PATH, and missing origins', async () => {
    const { service } = harness({}, new Set(['/configured/mihomo']));
    expect((await service.run()).map(item => [item.name, item.origin])).toEqual([['mihomo', 'configured'], ['sing-box', 'missing']]);
  });
  it('requires explicit confirmation and refusal performs no write', async () => {
    const confirm = vi.fn(async () => false); const installAtomic = vi.fn(); const { service } = harness({ confirm, installAtomic });
    expect((await service.run()).filter(item => item.required).every(item => item.origin === 'missing')).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1); expect(installAtomic).not.toHaveBeenCalled();
  });
  it('verifies, validates and installs required dependencies atomically', async () => {
    const { service, installed } = harness({ confirm: async () => true }); const result = await service.run();
    expect(installed).toEqual(['/runtime/bin/mihomo']); expect(result.filter(item => item.installed)).toHaveLength(1);
  });
  it('supports non-interactive confirmed setup from the bootstrap installer', async () => {
    const confirm = vi.fn(async () => false); const { service, installed } = harness({ confirm });
    await service.run({ assumeYes: true });
    expect(installed).toEqual(['/runtime/bin/mihomo']);
    expect(confirm).not.toHaveBeenCalled();
  });
  it('rejects checksum mismatch before installation', async () => {
    const installAtomic = vi.fn(); const { service } = harness({ confirm: async () => true, sha256: async () => 'wrong', installAtomic });
    await expect(service.run()).rejects.toThrow('Checksum mismatch'); expect(installAtomic).not.toHaveBeenCalled();
  });
  it.each([
    ['network failure', { download: async () => { throw new Error('connection reset after partial download'); } }],
    ['archive failure', { extract: async () => { throw new Error('truncated archive'); } }],
    ['permission failure', { installAtomic: async () => { throw new Error('EACCES'); } }],
  ] satisfies readonly [string, Partial<SetupAdapters>][])('reports %s without leaking credentials', async (_name, overrides) => {
    const { service } = harness({ confirm: async () => true, ...overrides }); const error = await service.run().catch(value => value as Error);
    expect(error.message).toContain('https://example.test/download'); expect(error.message).not.toContain('secret'); expect(error.message).not.toContain('token=private');
  });
  it('fails before prompting on unsupported hosts', async () => {
    const confirm = vi.fn(); const { service } = harness({ platform: async () => { throw new Error('Unsupported operating system: darwin'); }, confirm });
    await expect(service.run()).rejects.toThrow('Unsupported operating system'); expect(confirm).not.toHaveBeenCalled();
  });
});

describe('atomic managed installation', () => {
  it('preserves the previous executable when validation fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'miobridge-setup-test-'));
    const target = join(directory, 'mihomo');
    try {
      await writeFile(target, 'previous'); await chmod(target, 0o700);
      await expect(createNodeSetupAdapters().installAtomic(target, new TextEncoder().encode('replacement'), async () => { throw new Error('bad version'); })).rejects.toThrow('bad version');
      expect(await readFile(target, 'utf8')).toBe('previous');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
