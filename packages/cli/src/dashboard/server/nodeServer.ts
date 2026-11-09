import { AuthService } from '@miobridge/core';
import { recordMetric } from '../../operations/metricHistory.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { DashboardServerDependencies } from './composition.js';
import { registerCompatRoutes } from './compatRoutes.js';
import { registerCoreRoutes } from './coreRoutes.js';
import { registerConfigRoutes } from './configRoutes.js';
import { registerConvertRoutes } from './convertRoutes.js';
import { registerOperationsRoutes } from './operationsRoutes.js';
import { registerApplicationRoutes } from './applicationRoutes.js';
import {
  DashboardRouteRegistry,
  type DashboardHeaders,
  type DashboardHttpMethod,
  type DashboardRequest,
  type DashboardResponse,
  type DashboardRouteRegistrar,
} from './http.js';
import { serveStatic } from './staticServer.js';

const MAX_BODY_BYTES = 1024 * 1024;

export interface DashboardAppOptions {
  readonly auth?: AuthService;
  readonly root: string;
  readonly reservedPaths: readonly string[];
  readonly fallbackToIndex: boolean;
  readonly dependencies: DashboardServerDependencies;
  /** Optional composition seam for isolated adapters such as contract-test controls. */
  readonly extendRoutes?: (routes: DashboardRouteRegistrar) => void;
  /** Optional read-only observer used by diagnostics and HTTP contract harnesses. */
  readonly onRequest?: (request: DashboardRequest) => void | Promise<void>;
  /** Integration tests drive the app through `inject()` and want a quiet logger. */
  readonly logger?: boolean;
}

export interface NodeDashboardServerOptions extends DashboardAppOptions {
  readonly host: string;
  readonly port: number;
  readonly signal?: AbortSignal;
}

function headers(request: IncomingMessage): DashboardHeaders {
  return Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, value]));
}

/** 请求体读取失败要区分「太大」和「格式非法」，两者的状态码与恢复方式都不同。 */
class BodyError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'BodyError';
  }
}

function requestAdapter(request: IncomingMessage, response: ServerResponse, url: URL, method: DashboardHttpMethod, body: unknown, requestId: string): DashboardRequest {
  const listeners = new Map<() => void, () => void>();
  return {
    method: method === 'HEAD' ? 'GET' : method,
    path: url.pathname,
    query: Object.fromEntries([...url.searchParams.keys()].map(key => {
      const values = url.searchParams.getAll(key);
      return [key, values.length === 1 ? values[0] : values];
    })),
    headers: headers(request),
    body,
    params: {},
    requestId,
    ...(request.socket.remoteAddress ? { remoteAddress: request.socket.remoteAddress } : {}),
    onClose(listener) {
      const wrapped = () => listener();
      listeners.set(listener, wrapped);
      response.once('close', wrapped);
      return () => {
        const registered = listeners.get(listener);
        if (registered) response.off('close', registered);
        listeners.delete(listener);
      };
    },
  };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function responseAdapter(response: ServerResponse): DashboardResponse {
  return {
    status(code) { response.statusCode = code; return this; },
    header(name, value) { response.setHeader(name, value); return this; },
    json(value) {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(value));
    },
    text(value) { response.end(value); },
    write(value) { response.write(value); },
    end() { response.end(); },
  };
}

function registerRoutes(routes: DashboardRouteRegistry, dependencies: DashboardServerDependencies): void {
  registerCoreRoutes(routes, dependencies);
  registerCompatRoutes(routes, dependencies);
  registerOperationsRoutes(routes, dependencies);
  registerApplicationRoutes(routes, dependencies);
  registerConfigRoutes(routes, dependencies);
  registerConvertRoutes(routes, dependencies);
}

/**
 * Builds the dashboard Fastify instance without binding a socket, so both the
 * CLI runtime and `app.inject()`-driven integration tests exercise the exact
 * same routing, body-parsing, and error-envelope behaviour.
 */
export function createDashboardApp(options: DashboardAppOptions): FastifyInstance {
  const routes = new DashboardRouteRegistry();
  registerRoutes(routes, options.dependencies);
  options.extendRoutes?.(routes);

  const app = Fastify({ logger: options.logger ?? false, bodyLimit: MAX_BODY_BYTES, forceCloseConnections: true });

  app.addHook('onResponse', async (req, reply) => {
    options.dependencies.requestLogger?.debug('HTTP 请求', { method: req.method, path: req.url.split('?')[0], status: reply.statusCode });
  });
  app.addHook('onClose', async () => { options.dependencies.dispose?.(); });
  if (options.auth) {
    const auth = options.auth;
    const failures = new Map<string, { count: number; until: number }>();
    app.addHook('preHandler', async (req, reply) => {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (!path.startsWith('/api/') && !['/clash.yaml', '/subscription.txt', '/raw.txt'].includes(path)) return;
      const cookie = req.headers.cookie ?? '';
      const authorized = await auth.authorized(cookie, req.headers.authorization ?? '');
      if (path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.headers.host}`) {
        return reply.code(403).send({ success: false, error: '跨站请求被拒绝' });
      }
      if (path === '/api/auth/login' && req.method === 'POST') {
        const key = req.ip;
        const previous = failures.get(key);
        if (previous && previous.until > Date.now() && previous.count >= 10) return reply.code(429).send({ success: false, error: '请稍后重试' });
        const input = req.body as { token?: unknown } | undefined;
        const session = typeof input?.token === 'string' ? await auth.login(input.token) : null;
        if (!session) {
          if (failures.size > 1000) for (const [ip, entry] of failures) if (entry.until < Date.now()) failures.delete(ip);
          failures.set(key, { count: previous && previous.until > Date.now() ? previous.count + 1 : 1, until: Date.now() + 60_000 });
          return reply.code(401).send({ success: false, error: '登录令牌无效' });
        }
        failures.delete(key);
        return reply.header('Set-Cookie', `miobridge_session=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${req.protocol === 'https' ? '; Secure' : ''}`).send({ success: true });
      }
      if (path.startsWith('/api/') && !authorized) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: '请先登录', retryable: false } });
      if (path === '/api/auth/session') {
        const config = await auth.ensure();
        return reply.header('Cache-Control', 'no-store').send({ success: true, subscriptionRequired: config.subscription_required, subscriptionToken: config.subscription_token, publicBaseUrl: options.dependencies.core.getEffectiveConfig().app?.public_base_url ?? '' });
      }
      if (path === '/api/auth/subscription' && req.method === 'POST') { await auth.enableSubscriptions(); return reply.send({ success: true }); }
      if (path === '/api/auth/logout' && req.method === 'POST') return reply.header('Set-Cookie', 'miobridge_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0').send({ success: true });
      if (['/clash.yaml', '/subscription.txt', '/raw.txt'].includes(path)) {
        reply.header('Cache-Control', 'private, no-store');
        if (!await auth.subscriptionAuthorized(url.searchParams.get('token') ?? '')) return reply.code(401).send('Unauthorized');
      }
    });
  }

  // Reproduce the previous readBody() semantics: empty → undefined, JSON parsed
  // (invalid → 400 envelope), any other content type passed through as a raw
  // string. Body-limit overflow surfaces as Fastify's 413 in the error handler.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    if (body === '') { done(null, undefined); return; }
    try { done(null, JSON.parse(body as string)); }
    catch { done(new BodyError(400, 'INVALID_JSON', '请求体不是合法的 JSON'), undefined); }
  });
  app.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body === '' ? undefined : body);
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const requestId = firstHeader(request.headers['x-request-id']) ?? randomUUID();
    const failure = error instanceof BodyError
      ? error
      : error.statusCode === 413
      ? new BodyError(413, 'PAYLOAD_TOO_LARGE', '请求体超过 1 MiB 限制')
      : new BodyError(400, 'INVALID_BODY', error.message || '请求体无效');
    void reply.header('X-Request-ID', requestId).code(failure.status).send({
      success: false,
      error: { code: failure.code, message: failure.message, retryable: false },
      timestamp: new Date().toISOString(),
      requestId,
      role: 'admin',
    });
  });

  const handler = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const method = req.method as DashboardHttpMethod;
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const requestId = firstHeader(req.headers['x-request-id']) ?? randomUUID();
    // Hand the raw Node objects to the existing adapters and take over the
    // socket; Fastify only owns lifecycle, body parsing, and logging.
    reply.hijack();
    const request = requestAdapter(req.raw, reply.raw, url, method, req.body, requestId);
    const response = responseAdapter(reply.raw);
    response.header('X-Request-ID', requestId);
    if (/^\/api\/(?:yaml(?:\/|$)|configs$|cluster\/deploy)/.test(url.pathname)) response.header('Deprecation', 'true');
    try {
      await options.onRequest?.(request);
      if (await routes.dispatch(request, response)) return;
      if (method === 'GET' || method === 'HEAD') {
        const served = await serveStatic(request, response, {
          root: options.root,
          reservedPaths: options.reservedPaths,
          fallbackToIndex: options.fallbackToIndex,
        });
        if (served) return;
      }
      const allowed = routes.methodsFor(request.path);
      if (allowed.length) {
        response.status(405).header('Allow', allowed.join(', ')).json({
          success: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: `${method} 不被支持；允许 ${allowed.join('、')}`, retryable: false },
          timestamp: new Date().toISOString(),
          requestId,
          role: 'admin',
        });
        return;
      }
      if (!reply.raw.writableEnded) reply.raw.statusCode = 404;
      if (!reply.raw.writableEnded) reply.raw.end('Not Found');
    } catch (error) {
      if (!reply.raw.headersSent) reply.raw.statusCode = 500;
      if (!reply.raw.writableEnded) reply.raw.end(error instanceof Error ? error.message : 'Internal Server Error');
    }
  };
  app.all('/', handler);
  app.all('/*', handler);
  return app;
}

export async function runNodeDashboardServer(options: NodeDashboardServerOptions): Promise<number> {
  const auth = options.auth ?? new AuthService(options.dependencies.core.state);
  await auth.ensure();
  const app = createDashboardApp({ ...options, auth });

  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const close = () => { void app.close(); };
  let metricsTimer: NodeJS.Timeout | undefined;
  const cleanup = () => {
    if (metricsTimer) clearInterval(metricsTimer);
    signals.forEach(signal => process.off(signal, close));
    options.signal?.removeEventListener('abort', close);
  };
  // Hooks must be registered before listen(); resolve the exit promise when the
  // Fastify instance finishes closing (SIGINT/SIGTERM/SIGHUP or the abort signal).
  const exit = new Promise<number>((resolve, reject) => {
    app.addHook('onClose', () => { cleanup(); resolve(0); });
    app.server.once('error', error => { cleanup(); reject(error); });
  });

  await app.listen({ host: options.host, port: options.port });

  const sampleMetrics = async () => {
    const snapshot = await options.dependencies.core.getMetricsSnapshot();
    await recordMetric(options.dependencies.core.state, snapshot);
  };
  void sampleMetrics().catch(() => undefined);
  metricsTimer = setInterval(() => { void sampleMetrics().catch(() => undefined); }, 5 * 60_000);
  metricsTimer.unref?.();

  signals.forEach(signal => process.on(signal, close));
  options.signal?.addEventListener('abort', close, { once: true });
  if (options.signal?.aborted) close();

  return exit;
}
