import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DashboardForegroundService, createNodeForegroundAdapters, resolveDashboardRuntime } from '../../src/index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate port');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

describe('dashboard foreground lifecycle', () => {
  it('resolves configured, managed, then PATH Bun while preserving an effective child PATH', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miobridge-dashboard-bun-'));
    roots.push(root);
    const configured = join(root, 'configured');
    const managed = join(root, 'managed');
    const pathBin = join(root, 'path');
    await Promise.all([mkdir(configured), mkdir(managed), mkdir(pathBin)]);
    for (const file of [join(configured, 'bun'), join(managed, 'bun'), join(pathBin, 'bun')]) {
      await writeFile(file, '#!/bin/sh\nexit 0\n');
      await chmod(file, 0o755);
    }
    const paths = { managedBinDir: managed, pathDirectories: [pathBin] };
    await expect(resolveDashboardRuntime(paths, configured, { PATH: pathBin })).resolves.toMatchObject({
      executables: { bun: join(configured, 'bun') },
      effectivePath: expect.stringMatching(new RegExp(`^${configured}`)),
    });
    await rm(join(configured, 'bun'));
    await expect(resolveDashboardRuntime(paths, configured, { PATH: pathBin })).resolves.toMatchObject({ executables: { bun: join(managed, 'bun') } });
    await rm(join(managed, 'bun'));
    await expect(resolveDashboardRuntime(paths, undefined, { PATH: pathBin })).resolves.toMatchObject({ executables: { bun: join(pathBin, 'bun') } });
  });

  it('injects runtime ownership and serves every compatibility URL', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'miobridge-dashboard-'));
    roots.push(baseDir);
    const providerDir = join(baseDir, 'dist', 'dashboard');
    const artifact = join(providerDir, 'artifact');
    await mkdir(artifact, { recursive: true });
    await writeFile(join(artifact, 'server.js'), `
      const http = require('node:http');
      const expected = new Set(['/health', '/subscription.txt', '/clash.yaml', '/raw.txt']);
      if (!process.env.MIOBRIDGE_CONFIG_DIR || !process.env.CONFIG_FILE) process.exit(41);
      const server = http.createServer((request, response) => {
        if (!expected.delete(request.url)) { response.statusCode = 404; response.end('missing'); return; }
        response.end(request.url === '/health' ? 'ok' : 'fixture');
        if (expected.size === 0) setTimeout(() => server.close(() => process.exit(0)), 10);
      });
      server.listen(Number(process.env.PORT), process.env.HOSTNAME);
    `);
    const manifest = {
      schemaVersion: 1, dashboardVersion: 'test', artifactRoot: 'artifact', executable: basename(process.execPath),
      entrypoint: 'server.js', args: [],
      environment: { host: 'HOSTNAME', port: 'PORT', configDir: 'MIOBRIDGE_CONFIG_DIR', configFile: 'CONFIG_FILE' },
      healthUrl: 'http://{host}:{port}/health',
      compatibilityUrls: ['/health', '/subscription.txt', '/clash.yaml', '/raw.txt'].map(path => `http://{host}:{port}${path}`),
    };
    await writeFile(join(providerDir, 'provider.json'), JSON.stringify(manifest));
    const adapters = createNodeForegroundAdapters({ ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` });
    const port = await freePort();
    const running = new DashboardForegroundService({ baseDir, configFile: join(baseDir, 'config.yaml'), distDir: join(baseDir, 'dist') }, adapters).run({ host: '127.0.0.1', port });

    let ready = false;
    for (let attempt = 0; attempt < 50 && !ready; attempt += 1) {
      try { const response = await fetch(`http://127.0.0.1:${port}/health`); ready = response.ok; } catch { await new Promise(resolve => setTimeout(resolve, 20)); }
    }
    expect(ready).toBe(true);
    for (const path of ['/subscription.txt', '/clash.yaml', '/raw.txt']) {
      expect((await fetch(`http://127.0.0.1:${port}${path}`)).status).toBe(200);
    }
    await expect(running).resolves.toMatchObject({ exitCode: 0, healthUrl: `http://127.0.0.1:${port}/health` });
  });

  it('forwards termination signals and returns child status', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'miobridge-dashboard-fake-'));
    roots.push(baseDir);
    const providerDir = join(baseDir, 'dist', 'dashboard');
    await mkdir(join(providerDir, 'artifact'), { recursive: true });
    await writeFile(join(providerDir, 'artifact', 'server.js'), 'fixture');
    await writeFile(join(providerDir, 'provider.json'), JSON.stringify({
      schemaVersion: 1, dashboardVersion: 'test', artifactRoot: 'artifact', executable: 'runtime', entrypoint: 'server.js', args: ['--fixture'],
      environment: { host: 'HOSTNAME', port: 'PORT', configDir: 'MIOBRIDGE_CONFIG_DIR', configFile: 'CONFIG_FILE' },
      healthUrl: 'http://{host}:{port}/health', compatibilityUrls: ['/health', '/subscription.txt', '/clash.yaml', '/raw.txt'].map(path => `http://{host}:{port}${path}`),
    }));
    const signals: NodeJS.Signals[] = [];
    const listeners = new Map<NodeJS.Signals, () => void>();
    const spawned: Array<{ command: string; path?: string }> = [];
    const result = new DashboardForegroundService({ baseDir, configFile: join(baseDir, 'config.yaml'), distDir: join(baseDir, 'dist') }, {
      env: {}, resolveExecutable: async () => '/managed/runtime',
      spawn: (command, _args, options) => { spawned.push({ command, path: options.env.PATH }); return { wait: async () => { listeners.get('SIGTERM')?.(); return 9; }, signal: signal => signals.push(signal) }; },
      onSignal: (signal, listener) => { listeners.set(signal, listener); return () => listeners.delete(signal); },
    }, { effectivePath: '/effective/bin', executables: { runtime: '/configured/runtime' } }).run();
    await expect(result).resolves.toMatchObject({ exitCode: 9 });
    expect(spawned).toEqual([{ command: '/configured/runtime', path: '/effective/bin' }]);
    expect(signals).toEqual(['SIGTERM']);
    expect(listeners.size).toBe(0);
  });
});
