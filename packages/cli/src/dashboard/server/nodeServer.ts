import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
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
/** 超限后最多再排空多少倍的数据，用来保证 413 响应能送达而不被无限拖住。 */
const DRAIN_LIMIT_FACTOR = 8;
const METHODS = new Set<DashboardHttpMethod>(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

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

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  let overflow = false;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      // 超限后停止缓冲但继续排空请求流：直接 break 会销毁 socket，
      // 客户端就收不到我们正要发送的 413 响应了（表现为连接被重置）。
      overflow = true;
      chunks.length = 0;
      // 但也不能无限期陪跑，明显恶意的超大上传直接断开。
      if (size > MAX_BODY_BYTES * DRAIN_LIMIT_FACTOR) {
        request.destroy();
        throw new BodyError(413, 'PAYLOAD_TOO_LARGE', '请求体超过 1 MiB 限制');
      }
      continue;
    }
    chunks.push(chunk);
  }
  if (overflow) throw new BodyError(413, 'PAYLOAD_TOO_LARGE', '请求体超过 1 MiB 限制');
  if (chunks.length === 0) return undefined;
  const source = Buffer.concat(chunks).toString('utf8');
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.includes('application/json')) return source;
  try {
    return JSON.parse(source);
  } catch {
    throw new BodyError(400, 'INVALID_JSON', '请求体不是合法的 JSON');
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
  const responses = new Set<ServerResponse>();

  const server = createServer(async (incoming, outgoing) => {
    responses.add(outgoing);
    outgoing.once('close', () => responses.delete(outgoing));
    try {
      const method = incoming.method as DashboardHttpMethod | undefined;
      if (!method || !METHODS.has(method)) {
        outgoing.statusCode = 405;
        outgoing.end('Method Not Allowed');
        return;
      }
      const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? 'localhost'}`);
      // requestId 必须在读取 body 之前定下来：body 解析失败的响应同样要能被调用方关联。
      const requestId = firstHeader(incoming.headers['x-request-id']) ?? randomUUID();
      let body: unknown;
      try {
        body = await readBody(incoming);
      } catch (error) {
        const failure = error instanceof BodyError
          ? error
          : new BodyError(400, 'INVALID_BODY', error instanceof Error ? error.message : '请求体无效');
        outgoing.statusCode = failure.status;
        outgoing.setHeader('X-Request-ID', requestId);
        outgoing.setHeader('Content-Type', 'application/json; charset=utf-8');
        outgoing.end(JSON.stringify({
          success: false,
          error: { code: failure.code, message: failure.message, retryable: false },
          timestamp: new Date().toISOString(),
          requestId,
          role: 'admin',
        }));
        return;
      }
      const request = requestAdapter(incoming, outgoing, url, method, body, requestId);
      const response = responseAdapter(outgoing);
      response.header('X-Request-ID', request.requestId);
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
      if (!outgoing.writableEnded) outgoing.statusCode = 404;
      if (!outgoing.writableEnded) outgoing.end('Not Found');
    } catch (error) {
      if (!outgoing.headersSent) outgoing.statusCode = 500;
      if (!outgoing.writableEnded) outgoing.end(error instanceof Error ? error.message : 'Internal Server Error');
    }
  });
  const sockets = new Set<Socket>();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => reject(error);
    server.once('error', fail);
    server.listen(options.port, options.host, () => {
      server.off('error', fail);
      resolve();
    });
  });

  const sampleMetrics = async () => {
    const snapshot = await options.dependencies.core.getMetricsSnapshot();
    await options.dependencies.core.state.set(`metrics/${Date.now()}.json`, JSON.stringify(snapshot));
  };
  void sampleMetrics().catch(() => undefined);
  const metricsTimer = setInterval(() => { void sampleMetrics().catch(() => undefined); }, 5 * 60_000);
  metricsTimer.unref?.();

  return new Promise<number>((resolve, reject) => {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
    const close = () => {
      for (const response of responses) response.destroy();
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      server.close();
    };
    const cleanup = () => {
      clearInterval(metricsTimer);
      signals.forEach(signal => process.off(signal, close));
      options.signal?.removeEventListener('abort', close);
    };
    signals.forEach(signal => process.on(signal, close));
    options.signal?.addEventListener('abort', close, { once: true });
    if (options.signal?.aborted) close();
    server.once('close', () => { cleanup(); resolve(0); });
    server.once('error', error => { cleanup(); reject(error); });
  });
}
