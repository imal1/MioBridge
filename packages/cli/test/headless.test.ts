import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createNodeCore } from '../src/index.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('headless CLI composition', () => {
  it('generates state only beneath an injected base directory from an external cwd', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'miobridge-cli-headless-'));
    const cwd = join(sandbox, 'unrelated-cwd');
    const baseDir = join(sandbox, 'runtime');
    await mkdir(cwd);
    await writeFile(join(cwd, '.keep'), 'unchanged');
    const composition = createNodeCore({
      env: { MIOBRIDGE_CONFIG_DIR: baseDir, PATH: '' },
      metadata: { version: 'test' },
      uptime: () => 7,
      local: { isAvailable: async () => true, extractNodeUrls: async () => ['vless://id@headless.example:443#headless'] },
      remote: { collectRemoteNodeSources: async () => ({ sources: [], errors: [] }) },
      mihomo: {
        checkHealth: async () => true,
        getVersion: async () => ({ version: 'test-mihomo' }),
        convertToClashByContent: async () => 'proxies:\n  - name: headless\n',
      },
    });

    const previous = process.cwd();
    process.chdir(cwd);
    try {
      await composition.core.updateSubscription();
      const status = await composition.core.getStatus();
      expect(status).toMatchObject({ subscriptionExists: true, rawExists: true, clashExists: true, nodesCount: 1 });
      expect(composition.paths.baseDir).toBe(baseDir);
      expect(await readdir(cwd)).toEqual(['.keep']);
      expect((await readdir(baseDir)).sort()).toEqual(['artifact-state', 'backup', 'log', 'www']);
    } finally {
      process.chdir(previous);
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it('runs compiled status from an external cwd without frontend or dashboard artifacts', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'miobridge-cli-process-'));
    const cwd = join(sandbox, 'cwd');
    const baseDir = join(sandbox, 'runtime');
    await mkdir(cwd);
    await writeFile(join(cwd, '.keep'), 'unchanged');
    const entry = join(packageDir, 'dist', 'main.js');
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveResult, reject) => {
      const child = spawn(process.execPath, [entry, 'status', '--json'], {
        cwd,
        env: { ...process.env, MIOBRIDGE_CONFIG_DIR: baseDir, PATH: process.env.PATH ?? '' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += String(chunk); });
      child.stderr.on('data', chunk => { stderr += String(chunk); });
      child.once('error', reject);
      child.once('exit', code => resolveResult({ code, stdout, stderr }));
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ version: '1.2.1', subscriptionExists: false });
    expect(await readdir(cwd)).toEqual(['.keep']);
    await rm(sandbox, { recursive: true, force: true });
  });
});
