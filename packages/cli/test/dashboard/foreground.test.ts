import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardForegroundService, createNodeCore } from '../../src/index.js';
import { createNodeDashboardDependencies } from '../../src/dashboard/server/nodeDependencies.js';
import { runNodeDashboardServer } from '../../src/dashboard/server/nodeServer.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

async function providerFixture(): Promise<{ baseDir: string; root: string }> {
  const baseDir = await mkdtemp(join(tmpdir(), 'miobridge-dashboard-'));
  roots.push(baseDir);
  const dashboard = join(baseDir, 'dist', 'dashboard');
  const root = join(dashboard, 'artifact');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'index.html'), '<main>MioBridge</main>');
  await writeFile(join(dashboard, 'provider.json'), JSON.stringify({
    schemaVersion: 2,
    dashboardVersion: 'test',
    artifactRoot: 'artifact',
    spaFallback: true,
    reservedPaths: ['/api', '/health', '/subscription.txt', '/clash.yaml', '/raw.txt'],
  }));
  return { baseDir, root };
}

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
  it('loads the static provider and delegates serving to the CLI adapter', async () => {
    const { baseDir } = await providerFixture();
    const serve = vi.fn(async () => 7);
    const result = await new DashboardForegroundService({ distDir: join(baseDir, 'dist') }, { serve }).run({ host: '127.0.0.1', port: 4321 });
    expect(serve).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: 4321 }));
    expect(serve.mock.calls[0]?.[0].provider.root).toMatch(/miobridge-dashboard-.+\/dist\/dashboard\/artifact$/);
    expect(result).toMatchObject({ exitCode: 7, healthUrl: 'http://127.0.0.1:4321/health' });
  });

  it('serves core APIs, compatibility files, and SPA routes in one process', async () => {
    const { root } = await providerFixture();
    const port = await freePort();
    const controller = new AbortController();
    const dataDirectory = join(root, '..', '..', '..', 'www');
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(join(dataDirectory, 'subscription.txt'), 'subscription');
    await writeFile(join(dataDirectory, 'clash.yaml'), 'proxies: []');
    await writeFile(join(dataDirectory, 'raw.txt'), 'raw');
    const composition = createNodeCore({
      platformBaseDir: join(root, '..', '..', '..'),
      mihomo: {
        checkHealth: async () => true,
        getVersion: async () => ({ version: 'test' }),
        convertToClashByContent: async () => 'proxies: []',
      },
      local: { isAvailable: async () => false, extractNodeUrls: async () => [] },
      remote: { collectRemoteNodeSources: async () => ({ sources: [], errors: [] }) },
    });
    const observed: Array<{ path: string; query: unknown; body: unknown }> = [];
    const running = runNodeDashboardServer({
      host: '127.0.0.1', port, root,
      reservedPaths: ['/api', '/health', '/subscription.txt', '/clash.yaml', '/raw.txt'],
      fallbackToIndex: true,
      signal: controller.signal,
      dependencies: createNodeDashboardDependencies(composition),
      onRequest(request) { observed.push({ path: request.path, query: request.query, body: request.body }); },
      extendRoutes(routes) {
        routes.register({
          method: 'POST', path: '/__test__/control',
          handler(request, response) { response.json({ body: request.body, query: request.query }); },
        });
      },
    });

    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    expect((await fetch(`http://127.0.0.1:${port}/api/status`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/api/cluster/status`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/api/yaml/frontend`)).status).toBe(200);
    expect(await (await fetch(`http://127.0.0.1:${port}/subscription.txt`)).text()).toBe('subscription');
    expect(await (await fetch(`http://127.0.0.1:${port}/nodes`)).text()).toContain('MioBridge');
    expect(await (await fetch(`http://127.0.0.1:${port}/__test__/control?scenario=e2e`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true }),
    })).json()).toEqual({ body: { reset: true }, query: { scenario: 'e2e' } });
    expect(observed).toContainEqual({ path: '/__test__/control', query: { scenario: 'e2e' }, body: { reset: true } });
    controller.abort();
    await expect(running).resolves.toBe(0);
  });

  it('rejects invalid ports before loading the provider', async () => {
    const serve = vi.fn(async () => 0);
    await expect(new DashboardForegroundService({ distDir: '/missing' }, { serve }).run({ port: 0 })).rejects.toThrow('Invalid dashboard port');
    expect(serve).not.toHaveBeenCalled();
  });
});
