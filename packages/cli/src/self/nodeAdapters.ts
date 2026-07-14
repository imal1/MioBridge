import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, copyFile, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { detectLinuxPlatform } from '../platform/linux.js';
import type { SelfMaintenanceAdapters } from './service.js';

const execFileAsync = promisify(execFile);

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data).buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function tarString(data: Uint8Array, start: number, length: number): string {
  const end = data.subarray(start, start + length).indexOf(0);
  return new TextDecoder().decode(data.subarray(start, start + (end < 0 ? length : end))).trim();
}

function tarEntryName(data: Uint8Array, offset: number): string {
  const name = tarString(data, offset, 100);
  const prefix = tarString(data, offset + 345, 155);
  return `${prefix ? `${prefix}/` : ''}${name}`.replace(/^\.\//, '');
}

async function extractTarGzipEntry(data: Uint8Array, wanted: string): Promise<Uint8Array> {
  const tar = await gunzip(data);
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const name = tarEntryName(tar, offset);
    if (!name) break;
    const sizeText = tarString(tar, offset + 124, 12);
    const size = Number.parseInt(sizeText || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid tar entry size for ${name}`);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > tar.length) throw new Error(`Truncated tar entry: ${name}`);
    if (name === wanted) return tar.slice(contentStart, contentEnd);
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Release archive entry not found: ${wanted}`);
}

async function installDashboard(path: string, data: Uint8Array): Promise<void> {
  const tar = await gunzip(data);
  const temporary = `${path}.tmp-${randomUUID()}`;
  const backup = `${path}.backup-${randomUUID()}`;
  let hadPrevious = false;
  await mkdir(temporary, { recursive: true, mode: 0o755 });
  try {
    let offset = 0;
    let files = 0;
    while (offset + 512 <= tar.length) {
      const name = tarEntryName(tar, offset);
      if (!name) break;
      const size = Number.parseInt(tarString(tar, offset + 124, 12) || '0', 8);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid tar entry size for ${name}`);
      const contentStart = offset + 512;
      const contentEnd = contentStart + size;
      if (contentEnd > tar.length) throw new Error(`Truncated tar entry: ${name}`);
      if (name === 'dashboard' || name.startsWith('dashboard/')) {
        const relative = name.replace(/^dashboard\/?/, '');
        if (relative.split('/').includes('..')) throw new Error(`Unsafe dashboard archive entry: ${name}`);
        const target = join(temporary, relative);
        const type = String.fromCharCode(tar[offset + 156] ?? 0);
        if (relative && (type === '5' || name.endsWith('/'))) {
          await mkdir(target, { recursive: true, mode: 0o755 });
        } else if (relative && (type === '\0' || type === '0')) {
          await mkdir(dirname(target), { recursive: true, mode: 0o755 });
          await writeFile(target, tar.slice(contentStart, contentEnd), { mode: 0o644 });
          files += 1;
        } else if (relative && !['x', 'g', 'L', 'K'].includes(type)) {
          throw new Error(`Unsupported dashboard archive entry: ${name}`);
        }
      }
      offset = contentStart + Math.ceil(size / 512) * 512;
    }
    if (files === 0) throw new Error('Release archive has no dashboard files');
    await Promise.all([
      readFile(join(temporary, 'provider.json')),
      readFile(join(temporary, 'artifact', 'index.html')),
    ]);
    try { await rename(path, backup); hadPrevious = true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await mkdir(dirname(path), { recursive: true, mode: 0o755 });
    await rename(temporary, path);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (hadPrevious) await rename(backup, path).catch(() => undefined);
    throw error;
  }
}

async function installAtomic(path: string, data: Uint8Array, validate: (temporaryPath: string) => Promise<void>): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  const temporary = `${path}.tmp-${randomUUID()}`;
  const backup = `${path}.backup-${randomUUID()}`;
  let hadPrevious = false;
  try {
    const file = await open(temporary, 'wx', 0o755);
    try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
    await chmod(temporary, 0o755);
    await validate(temporary);
    try { await copyFile(path, backup, constants.COPYFILE_EXCL); hadPrevious = true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rename(temporary, path);
    await rm(backup, { force: true });
  } catch (error) {
    await rm(temporary, { force: true });
    if (hadPrevious) await rename(backup, path).catch(() => undefined);
    throw error;
  }
}

export function createNodeSelfMaintenanceAdapters(): SelfMaintenanceAdapters {
  return {
    async platform() {
      let osRelease = '';
      try { osRelease = await readFile('/etc/os-release', 'utf8'); } catch { /* unknown distro */ }
      return detectLinuxPlatform({ platform: platform(), architecture: arch(), osRelease });
    },
    async latestVersion(repository) {
      const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'miobridge-cli' },
        redirect: 'follow', signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Could not resolve latest release: HTTP ${response.status}`);
      const body = await response.json() as { tag_name?: unknown };
      if (typeof body.tag_name !== 'string') throw new Error('Latest release response has no tag_name');
      return body.tag_name;
    },
    async download(url) {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}: ${new URL(url).pathname}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    async sha256(data) { return createHash('sha256').update(data).digest('hex'); },
    extractTarGzipEntry,
    installAtomic,
    installDashboard,
    async probeVersion(path) {
      const result = await execFileAsync(path, ['--version'], { timeout: 15_000 });
      return result.stdout.trim();
    },
    async writeVersion(path, version) { await writeFile(path, `${version}\n`, { mode: 0o644 }); },
    async remove(path) { await rm(path, { force: true }); },
  };
}
