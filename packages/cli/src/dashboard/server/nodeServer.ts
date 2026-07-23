import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
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

export interface NodeDashboardServerOptions {
  readonly host: string;
  readonly port: number;
  readonly root: string;
  readonly reservedPaths: readonly string[];
  readonly fallbackToIndex: boolean;
  readonly dependencies: DashboardServerDependencies;
  /** Optional composition seam for isolated adapters such as contract-test controls. */
  readonly extendRoutes?: (routes: DashboardRouteRegistrar) => void;
  /** Optional read-only observer used by diagnostics and HTTP contract harnesses. */
  readonly onRequest?: (request: DashboardRequest) => void | Promise<void>;
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

export async function runNodeDashboardServer(options: NodeDashboardServerOptions): Promise<number> {
  const routes = new DashboardRouteRegistry();
  registerRoutes(routes, options.dependencies);
  options.extendRoutes?.(routes);

  const app = Fastify({ logger: true, bodyLimit: MAX_BODY_BYTES, forceCloseConnections: true });

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
      if (!reply.raw.writableEnded) reply.raw.statusCode = 404;
      if (!reply.raw.writableEnded) reply.raw.end('Not Found');
    } catch (error) {
      if (!reply.raw.headersSent) reply.raw.statusCode = 500;
      if (!reply.raw.writableEnded) reply.raw.end(error instanceof Error ? error.message : 'Internal Server Error');
    }
  };
  app.all('/', handler);
  app.all('/*', handler);

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
    await options.dependencies.core.state.set(`metrics/${Date.now()}.json`, JSON.stringify(snapshot));
  };
  void sampleMetrics().catch(() => undefined);
  metricsTimer = setInterval(() => { void sampleMetrics().catch(() => undefined); }, 5 * 60_000);
  metricsTimer.unref?.();

  signals.forEach(signal => process.on(signal, close));
  options.signal?.addEventListener('abort', close, { once: true });
  if (options.signal?.aborted) close();

  return exit;
}
