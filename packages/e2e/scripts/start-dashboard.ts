import { AuthService } from '@miobridge/core';
import { runNodeDashboardServer, type DashboardRequest, type DashboardRouteRegistrar } from '@miobridge/cli';
import { fileURLToPath } from 'node:url';
import { createE2EHarness } from '../harness/createHarness.js';

const host = '127.0.0.1';
const port = Number(process.env.MIOBRIDGE_E2E_PORT ?? 4173);
const origin = `http://${host}:${port}`;
const root = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));

function bodyObject(request: DashboardRequest): Record<string, unknown> {
  return request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : {};
}

const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), origin);
  if (url.origin !== origin) throw new Error(`E2E server blocked external fetch: ${url.origin}`);
  return nativeFetch(input, init);
};

const harness = await createE2EHarness({ origin });
const authValues = new Map<string, string>([['auth.yaml', JSON.stringify({ admin_token: 'e'.repeat(64), subscription_token: 'f'.repeat(64), subscription_required: false })]]);
const auth = new AuthService({ kind: 'file', get: async key => authValues.get(key) ?? null, set: async (key, value) => { authValues.set(key, value); }, del: async key => { authValues.delete(key); }, listKeys: async prefix => [...authValues.keys()].filter(key => key.startsWith(prefix)), withLock: async (_key, fn) => fn() });


function extendRoutes(routes: DashboardRouteRegistrar): void {
  routes.register({
    method: 'POST',
    path: '/__e2e__/reset',
    async handler(request, response) {
      const scenario = bodyObject(request).scenario;
      await harness.reset(typeof scenario === 'string' ? scenario : 'baseline');
      response.json({ success: true });
    },
  });
  routes.register({
    method: 'POST',
    path: '/__e2e__/control',
    async handler(request, response) {
      await harness.control(bodyObject(request));
      response.json({ success: true });
    },
  });
  routes.register({
    method: 'GET',
    path: '/__e2e__/state',
    async handler(_request, response) {
      response.json(await harness.snapshot());
    },
  });
  routes.register({
    method: 'POST',
    path: '/__e2e__/webhook',
    async handler(request, response) {
      await harness.recordWebhook?.(request.body);
      const snapshot = await harness.snapshot();
      const status = snapshot.webhookStatus === 500 ? 500 : 204;
      response.status(status).json({ ok: status < 400 });
    },
  });
}

await runNodeDashboardServer({
  auth,
  host,
  port,
  root,
  fallbackToIndex: true,
  reservedPaths: ['/api', '/health', '/subscription.txt', '/clash.yaml', '/raw.txt', '/__e2e__'],
  dependencies: harness.dependencies,
  extendRoutes,
  onRequest: request => harness.recordRequest?.(request),
});
