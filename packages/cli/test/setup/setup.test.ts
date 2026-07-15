import { describe, expect, it, vi } from 'vitest';
import { createRuntimePaths } from '@miobridge/core';
import { detectLinuxPlatform } from '../../src/platform/linux.js';
import { downloadBytes } from '../../src/platform/download.js';
import { DependencySetupService } from '../../src/setup/service.js';
import { createNodeSetupAdapters } from '../../src/setup/nodeAdapters.js';
import { LocalKernelInstallationService } from '../../src/setup/kernelService.js';
import { PINNED_KERNEL_ARTIFACTS } from '../../src/setup/kernelCatalog.js';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, gzipSync } from 'node:zlib';
import type { ArtifactCatalog, SetupAdapters } from '../../src/setup/types.js';

const bytes = new Uint8Array([1, 2, 3]);
const artifact = { version: 'v1.2.3', url: 'https://user:secret@example.test/download?token=private', sha256: 'trusted', archive: 'binary' as const, versionArgs: ['--version'] };
const artifacts: ArtifactCatalog = { mihomo: { x64: artifact, arm64: artifact } };

function zipEntry(name: string, contents: Uint8Array): Uint8Array {
  const encodedName = Buffer.from(name);
  const compressed = deflateRawSync(contents);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(contents.length, 22);
  header.writeUInt16LE(encodedName.length, 26);
  return new Uint8Array(Buffer.concat([header, encodedName, compressed]));
}

function tarEntry(name: string, contents: Uint8Array): Uint8Array {
  const size = Math.ceil(contents.length / 512) * 512;
  const archive = Buffer.alloc(512 + size + 1024);
  archive.write(name, 0, 100, 'utf8');
  archive.write(`${contents.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  archive[156] = '0'.charCodeAt(0);
  Buffer.from(contents).copy(archive, 512);
  return new Uint8Array(archive);
}

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

describe('release downloads', () => {
  it('retries transient fetch failures before returning verified bytes', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(new Response(bytes));
    await expect(downloadBytes('https://example.test/artifact', {
      attempts: 2,
      retryDelayMs: 0,
      fetcher,
    })).resolves.toEqual(bytes);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reports the final error after exhausting retries', async () => {
    const fetcher = vi.fn(async () => { throw new Error('network unavailable'); });
    await expect(downloadBytes('https://example.test/artifact', {
      attempts: 3,
      retryDelayMs: 0,
      fetcher,
    })).rejects.toThrow('network unavailable');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
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
  it('extracts gzip dependencies without relying on browser stream globals', async () => {
    const contents = new TextEncoder().encode('mihomo executable fixture');
    vi.stubGlobal('DecompressionStream', undefined);
    try {
      const result = await createNodeSetupAdapters().extract(new Uint8Array(gzipSync(contents)), {
        ...artifact,
        archive: 'gzip',
      });
      expect(result).toEqual(contents);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('extracts deflated zip dependencies with node-compatible zlib', async () => {
    const contents = new TextEncoder().encode('zip executable fixture');
    const result = await createNodeSetupAdapters().extract(zipEntry('tool.exe', contents), {
      ...artifact,
      archive: 'zip',
      entry: 'tool.exe',
    });
    expect(result).toEqual(contents);
  });

  it('extracts a binary from a gzip-compressed tar archive', async () => {
    const contents = new TextEncoder().encode('sing-box executable fixture');
    const result = await createNodeSetupAdapters().extract(new Uint8Array(gzipSync(tarEntry('release/sing-box', contents))), {
      ...artifact,
      archive: 'tar-gzip',
      entry: 'release/sing-box',
    });
    expect(result).toEqual(contents);
  });

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

describe('local kernel installation', () => {
  it('downloads, verifies, and installs a configured kernel into the managed bin directory', async () => {
    const installed: string[] = [];
    const pinned = PINNED_KERNEL_ARTIFACTS['sing-box'].x64;
    const paths = createRuntimePaths({ env: { PATH: '/usr/bin' }, platformBaseDir: '/runtime' });
    const adapters: SetupAdapters = {
      platform: async () => ({ os: 'linux', architecture: 'x64', distro: 'debian' }),
      existsExecutable: async () => false,
      probeVersion: async () => `sing-box version ${pinned.version}`,
      confirm: async () => false,
      download: async () => bytes,
      sha256: async () => pinned.sha256,
      extract: async data => data,
      installAtomic: async (path, _data, validate) => { await validate(`${path}.tmp`); installed.push(path); },
    };
    const result = await new LocalKernelInstallationService(paths, adapters).ensure('sing-box');
    expect(result).toMatchObject({ type: 'sing-box', path: '/runtime/bin/sing-box', installed: true });
    expect(installed).toEqual(['/runtime/bin/sing-box']);
  });
});
