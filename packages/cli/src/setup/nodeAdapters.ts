import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Artifact, SetupAdapters } from './types.js';
import { detectLinuxPlatform } from '../platform/linux.js';

const execFileAsync = promisify(execFile);

async function command(path: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(path, [...args], { timeout: 15_000, maxBuffer: 1024 * 1024 });
  return `${result.stdout}${result.stderr}`.trim();
}

async function decompress(data: Uint8Array, format: 'gzip' | 'deflate-raw'): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data).buffer]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extractZipEntry(data: Uint8Array, wanted: string): Promise<Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= data.length && view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true);
    const compression = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if ((flags & 0x08) !== 0) throw new Error('Unsupported zip data descriptor');
    const contentOffset = offset + 30 + nameLength + extraLength;
    const name = decoder.decode(data.subarray(offset + 30, offset + 30 + nameLength));
    const compressed = data.subarray(contentOffset, contentOffset + compressedSize);
    if (name === wanted) {
      if (compression === 0) return compressed.slice();
      if (compression === 8) return decompress(compressed, 'deflate-raw');
      throw new Error(`Unsupported zip compression method: ${compression}`);
    }
    offset = contentOffset + compressedSize;
  }
  throw new Error(`Archive entry not found: ${wanted}`);
}

async function extract(data: Uint8Array, artifact: Artifact): Promise<Uint8Array> {
  if (artifact.archive === 'binary') return data;
  if (artifact.archive === 'gzip') return decompress(data, 'gzip');
  if (!artifact.entry) throw new Error('Zip artifact has no entry');
  return extractZipEntry(data, artifact.entry);
}

export function createNodeSetupAdapters(): SetupAdapters {
  return {
    async platform() {
      let osRelease = '';
      try { osRelease = await readFile('/etc/os-release', 'utf8'); } catch { /* unknown distro */ }
      return detectLinuxPlatform({ platform: platform(), architecture: arch(), osRelease });
    },
    async existsExecutable(path) { try { await access(path, constants.X_OK); return true; } catch { return false; } },
    probeVersion: command,
    async confirm(message) {
      if (!process.stdin.isTTY) return false;
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try { return /^(?:y|yes)$/i.test((await prompt.question(`${message} [y/N] `)).trim()); } finally { prompt.close(); }
    },
    async download(url) {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    async sha256(data) { return createHash('sha256').update(data).digest('hex'); },
    extract,
    async installAtomic(target, data, validate) {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const temporary = `${target}.tmp-${randomUUID()}`;
      const backup = `${target}.backup-${randomUUID()}`;
      let hadPrevious = false;
      try {
        const file = await open(temporary, 'wx', 0o700);
        try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
        await chmod(temporary, 0o700);
        await validate(temporary);
        try { await copyFile(target, backup, constants.COPYFILE_EXCL); hadPrevious = true; } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await rename(temporary, target);
        await rm(backup, { force: true });
      } catch (error) {
        await rm(temporary, { force: true });
        if (hadPrevious) await rename(backup, target).catch(() => undefined);
        throw error;
      }
    },
  };
}
