import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { afterEach } from 'vitest';
import {
  createDashboardTestRequest,
  createDashboardTestResponse,
} from '../../src/dashboard/server/http.js';
import { serveStatic } from '../../src/dashboard/server/staticServer.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

async function createStaticRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'miobridge-static-test-'));
  roots.push(root);
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(root, relPath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content);
  }
  return root;
}

describe('static server', () => {
  it('serves a real file', async () => {
    const root = await createStaticRoot({ 'index.html': '<html></html>' });
    const req = createDashboardTestRequest({ path: '/index.html' });
    const res = createDashboardTestResponse();
    const handled = await serveStatic(req, res, { root, reservedPaths: [] });
    expect(handled).toBe(true);
    expect(res.body).toContain('<html>');
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
  });

  it('returns correct MIME for JS', async () => {
    const root = await createStaticRoot({ 'assets/index-abc12345.js': 'console.log(1)' });
    const req = createDashboardTestRequest({ path: '/assets/index-abc12345.js' });
    const res = createDashboardTestResponse();
    const handled = await serveStatic(req, res, { root, reservedPaths: [] });
    expect(handled).toBe(true);
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('returns correct MIME for CSS', async () => {
    const root = await createStaticRoot({ 'style.css': 'body { }' });
    const req = createDashboardTestRequest({ path: '/style.css' });
    const res = createDashboardTestResponse();
    const handled = await serveStatic(req, res, { root, reservedPaths: [] });
    expect(handled).toBe(true);
    expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
  });

  it('denies traversal via ..', async () => {
    const root = await createStaticRoot({ 'index.html': 'ok' });
    const req = createDashboardTestRequest({ path: '/../etc/passwd' });
    const res = createDashboardTestResponse();
    const handled = await serveStatic(req, res, { root, reservedPaths: [] });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(403);
  });

  it('denies null-byte injection', async () => {
    const root = await createStaticRoot({ 'index.html': 'ok' });
    const req = createDashboardTestRequest({ path: '/index.html%00.bak' });
    const res = createDashboardTestResponse();
    const handled = await serveStatic(req, res, { root, reservedPaths: [] });
    // Non-existent file but not a traversal; returns false to let router handle
    expect(handled).toBe(false);
  });

  it('reserved paths are not served', async () => {
    const root = await createStaticRoot({ 'api/status': 'bad' });
    const req = createDashboardTestRequest({ path: '/api/status' });
    const res = createDashboardTestResponse();
    const handled = await serveStatic(req, res, { root, reservedPaths: ['/api'] });
    expect(handled).toBe(false);
  });

  it('SPA fallback serves index.html', async () => {
    const root = await createStaticRoot({ 'index.html': '<html>SPA</html>' });
    const req = createDashboardTestRequest({ path: '/deep/nested/page' });
    const res = createDashboardTestResponse();
    const handled = await serveStatic(req, res, { root, reservedPaths: [], fallbackToIndex: true });
    expect(handled).toBe(true);
    expect(res.body).toContain('SPA');
  });

  it('returns false for missing file without fallback', async () => {
    const root = await createStaticRoot({});
    const req = createDashboardTestRequest({ path: '/missing' });
    const res = createDashboardTestResponse();
    const handled = await serveStatic(req, res, { root, reservedPaths: [] });
    expect(handled).toBe(false);
  });
});
