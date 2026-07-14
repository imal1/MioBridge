import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { DashboardServerDependencies } from './composition.js';
import { registerCompatRoutes } from './compatRoutes.js';
import { registerCoreRoutes } from './coreRoutes.js';
import { registerConfigRoutes } from './configRoutes.js';
import { registerConvertRoutes } from './convertRoutes.js';
import { registerOperationsRoutes } from './operationsRoutes.js';
import {
  DashboardRouteRegistry,
  type DashboardHeaders,
  type DashboardHttpMethod,
  type DashboardRequest,
  type DashboardResponse,
} from './http.js';
import { serveStatic } from './staticServer.js';

const MAX_BODY_BYTES = 1024 * 1024;
const METHODS = new Set<DashboardHttpMethod>(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

export interface NodeDashboardServerOptions {
  readonly host: string;
  readonly port: number;
  readonly root: string;
  readonly reservedPaths: readonly string[];
  readonly fallbackToIndex: boolean;
  readonly dependencies: DashboardServerDependencies;
  readonly signal?: AbortSignal;
}

function headers(request: IncomingMessage): DashboardHeaders {
  return Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, value]));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body exceeds 1 MiB');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return undefined;
  const source = Buffer.concat(chunks).toString('utf8');
  const contentType = request.headers['content-type'] ?? '';
  return contentType.includes('application/json') ? JSON.parse(source) : source;
}

function requestAdapter(request: IncomingMessage, url: URL, method: DashboardHttpMethod, body: unknown): DashboardRequest {
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
    ...(request.socket.remoteAddress ? { remoteAddress: request.socket.remoteAddress } : {}),
    onClose(listener) {
      const wrapped = () => listener();
      listeners.set(listener, wrapped);
      request.once('close', wrapped);
      return () => {
        const registered = listeners.get(listener);
        if (registered) request.off('close', registered);
        listeners.delete(listener);
      };
    },
  };
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
  registerConfigRoutes(routes, dependencies);
  registerConvertRoutes(routes, dependencies);
}

export async function runNodeDashboardServer(options: NodeDashboardServerOptions): Promise<number> {
  const routes = new DashboardRouteRegistry();
  registerRoutes(routes, options.dependencies);

  const server = createServer(async (incoming, outgoing) => {
    try {
      const method = incoming.method as DashboardHttpMethod | undefined;
      if (!method || !METHODS.has(method)) {
        outgoing.statusCode = 405;
        outgoing.end('Method Not Allowed');
        return;
      }
      const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? 'localhost'}`);
      let body: unknown;
      try {
        body = await readBody(incoming);
      } catch (error) {
        outgoing.statusCode = 400;
        outgoing.setHeader('Content-Type', 'application/json; charset=utf-8');
        outgoing.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Invalid request body' }));
        return;
      }
      const request = requestAdapter(incoming, url, method, body);
      const response = responseAdapter(outgoing);
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

  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => reject(error);
    server.once('error', fail);
    server.listen(options.port, options.host, () => {
      server.off('error', fail);
      resolve();
    });
  });

  return new Promise<number>((resolve, reject) => {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
    const close = () => server.close();
    const cleanup = () => {
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
