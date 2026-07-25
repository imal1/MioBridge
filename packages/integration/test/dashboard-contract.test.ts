/**
 * HTTP contract tests driven through `app.inject()`. The endpoint list is read
 * from the server's own `/api/openapi.json`, so a route that is documented but
 * never registered (or renamed without updating the document) fails here
 * instead of silently 404ing in production.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createTestApp } from './support/app.js';
import { applicationEnvelope, assertEnvelope, assertSchema, healthEnvelope } from './support/schemas.js';

const app = createTestApp();
await app.ready();
afterAll(async () => { await app.close(); });

const SAMPLE_PARAMS: Record<string, string> = {
  id: 'task-1', name: 'clash.yaml', component: 'mihomo', action: 'restart',
};

/** SSE routes long-poll until the client disconnects, so they need their own
 *  cancellation-aware test rather than a one-shot inject. */
const STREAMING = (path: string) => path.endsWith('/events');
/**
 * Endpoints that deliberately answer with something other than a JSON envelope:
 * compatibility artifacts, plain-text deployment logs, and the YAML config
 * export. Each is asserted separately where its own shape matters.
 */
const NON_JSON = new Set([
  '/raw.txt', '/subscription.txt', '/clash.yaml', '/health',
  '/api/deployments/{id}/logs', '/api/config/export',
]);

const document = (await app.inject({ method: 'GET', url: '/api/openapi.json' })).json() as {
  paths: Record<string, Record<string, unknown>>;
};

const declared = Object.entries(document.paths).flatMap(([path, operations]) =>
  Object.keys(operations).map(method => ({ method: method.toUpperCase(), path })));

const concrete = (path: string) => path.replace(/\{(\w+)\}/gu, (_match, key: string) => SAMPLE_PARAMS[key] ?? 'sample');

describe('openapi document', () => {
  it('declares a non-empty path table', () => {
    expect(declared.length).toBeGreaterThan(30);
  });

  const dispatchable = declared.filter(entry => !STREAMING(entry.path));

  it.each(dispatchable)('$method $path dispatches to a registered route', async ({ method, path }) => {
    const response = await app.inject({
      method: method as 'GET',
      url: concrete(path),
      ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }),
    });
    // 404 means the document promises an endpoint the registry never registered.
    expect(response.statusCode, `${method} ${path} -> ${response.body.slice(0, 200)}`).not.toBe(404);
  });

  const jsonGets = declared.filter(entry =>
    entry.method === 'GET' && !STREAMING(entry.path) && !NON_JSON.has(entry.path));

  it.each(jsonGets)('GET $path answers with a known envelope dialect', async ({ path }) => {
    const response = await app.inject({ method: 'GET', url: concrete(path) });
    expect(response.headers['content-type']).toContain('application/json');
    assertEnvelope(response.json(), `GET ${path}`);
  });
});

describe('envelope correlation', () => {
  it('echoes a caller-supplied request id on success and inside the body', async () => {
    const response = await app.inject({
      method: 'GET', url: '/api/deployments', headers: { 'x-request-id': 'caller-supplied' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('caller-supplied');
    assertSchema(applicationEnvelope, response.json(), 'GET /api/deployments');
    expect(response.json()).toMatchObject({ success: true, requestId: 'caller-supplied', role: 'admin' });
  });

  it('mints a request id when the caller omits one', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/deployments' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('serves the config export as YAML and deployment logs as plain text', async () => {
    const yaml = await app.inject({ method: 'GET', url: '/api/config/export' });
    expect(yaml.statusCode).toBe(200);
    expect(yaml.headers['content-type']).toContain('application/yaml');

    const logs = await app.inject({ method: 'GET', url: '/api/deployments/task-1/logs' });
    expect(logs.headers['content-type']).toContain('text/plain');
  });

  it('pins the /health payload shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    assertSchema(healthEnvelope, response.json(), 'GET /health');
  });
});

describe('body handling', () => {
  it('rejects malformed JSON with a structured 400 envelope', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/deployments',
      headers: { 'content-type': 'application/json', 'x-request-id': 'bad-json' },
      payload: '{"unterminated":',
    });
    expect(response.statusCode).toBe(400);
    assertSchema(applicationEnvelope, response.json(), 'malformed JSON');
    expect(response.json()).toMatchObject({
      success: false, requestId: 'bad-json',
      error: { code: 'INVALID_JSON', retryable: false },
    });
  });

  it('rejects bodies over the 1 MiB limit with 413', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/deployments',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 64) }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('treats an empty JSON body as absent rather than failing to parse', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/config/validate',
      headers: { 'content-type': 'application/json' }, payload: '',
    });
    expect(response.statusCode).not.toBe(400);
  });
});

describe('unmatched requests', () => {
  it('404s an unknown api path without a static fallback', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(response.body).toBe('Not Found');
  });

  it('refuses directory traversal outside the static root', async () => {
    const response = await app.inject({ method: 'GET', url: '/../package.json' });
    expect([403, 404]).toContain(response.statusCode);
  });
});
