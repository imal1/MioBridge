import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  }));
  return nested.flat().filter(path => path.endsWith('.ts'));
}

describe('@miobridge/core package boundary', () => {
  it('has no reverse framework, frontend, SSH, or deployment imports', async () => {
    const files = await sourceFiles(join(packageDir, 'src'));
    const sources = await Promise.all(files.map(file => readFile(file, 'utf8')));
    const importSpecifiers = sources.join('\n').matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)/g);
    const forbidden = /^(?:next(?:\/|$)|react(?:\/|$)|frontend\/|@\/|node-ssh(?:\/|$))|(?:ssh|deploy|systemd)/i;

    expect([...importSpecifiers].map(match => match[1]).filter(Boolean)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(forbidden)]),
    );
  });

  it.each(['bun', 'node'])('loads from an external cwd under %s without filesystem side effects', async runtime => {
    const cwd = await mkdtemp(join(tmpdir(), 'miobridge-core-cwd-'));
    const entry = join(packageDir, 'dist', 'index.js');
    const script = `import { CORE_PACKAGE_NAME } from ${JSON.stringify(entry)}; if (CORE_PACKAGE_NAME !== '@miobridge/core') process.exit(2);`;
    const args = runtime === 'bun' ? ['-e', script] : ['--input-type=module', '-e', script];
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      const child = spawn(runtime, args, { cwd, stdio: 'pipe' });
      child.once('error', reject);
      child.once('exit', resolveExit);
    });

    expect(exitCode).toBe(0);
    expect(await readdir(cwd)).toEqual([]);
    await rm(cwd, { recursive: true, force: true });
  });
});
