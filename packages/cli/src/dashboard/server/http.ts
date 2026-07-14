/**
 * Framework-neutral HTTP vocabulary for dashboard adapters.
 *
 * Keep this module deliberately small: Node's incoming/outgoing message
 * adapters belong at the CLI runtime edge, while route implementations only
 * depend on these values. The test helpers replay frozen HTTP contracts without
 * starting a network listener.
 */
export type DashboardHttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export type DashboardHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

export interface DashboardRequest {
  readonly method: DashboardHttpMethod;
  readonly path: string;
  readonly query: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly headers: DashboardHeaders;
  readonly body: unknown;
  readonly remoteAddress?: string;
  onClose(listener: () => void): () => void;
}

export interface DashboardResponse {
  status(code: number): this;
  header(name: string, value: string): this;
  json(value: unknown): void;
  text(value: string): void;
  write(value: string | Uint8Array): void;
  end(): void;
}

export type DashboardRouteHandler = (request: DashboardRequest, response: DashboardResponse) => void | Promise<void>;

export interface DashboardRoute {
  readonly method: DashboardHttpMethod;
  readonly path: string;
  readonly handler: DashboardRouteHandler;
}

export interface DashboardRouteRegistrar {
  register(route: DashboardRoute): void;
}

export class DashboardRouteRegistry implements DashboardRouteRegistrar {
  readonly #routes = new Map<string, DashboardRoute>();

  register(route: DashboardRoute): void {
    const key = `${route.method} ${route.path}`;
    if (this.#routes.has(key)) throw new Error(`Dashboard route already registered: ${key}`);
    this.#routes.set(key, route);
  }

  routes(): readonly DashboardRoute[] {
    return [...this.#routes.values()];
  }

  async dispatch(request: DashboardRequest, response: DashboardResponse): Promise<boolean> {
    const route = this.#routes.get(`${request.method} ${request.path}`);
    if (!route) return false;
    await route.handler(request, response);
    return true;
  }
}

export interface DashboardTestRequestOptions {
  readonly method?: DashboardHttpMethod;
  readonly path?: string;
  readonly query?: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly headers?: DashboardHeaders;
  readonly body?: unknown;
  readonly remoteAddress?: string;
}

export function createDashboardTestRequest(options: DashboardTestRequestOptions = {}): DashboardRequest & { close(): void } {
  const listeners = new Set<() => void>();
  return {
    method: options.method ?? 'GET',
    path: options.path ?? '/',
    query: options.query ?? {},
    headers: options.headers ?? {},
    body: options.body,
    ...(options.remoteAddress ? { remoteAddress: options.remoteAddress } : {}),
    onClose(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close() { for (const listener of listeners) listener(); },
  };
}

export interface DashboardTestResponse extends DashboardResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly ended: boolean;
}

export function createDashboardTestResponse(): DashboardTestResponse {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let body = '';
  let ended = false;

  const response: DashboardResponse = {
    status(code) { statusCode = code; return this; },
    header(name, value) { headers[name.toLowerCase()] = value; return this; },
    json(value) { this.header('Content-Type', 'application/json; charset=utf-8'); body += JSON.stringify(value); ended = true; },
    text(value) { body += value; ended = true; },
    write(value) { body += typeof value === 'string' ? value : new TextDecoder().decode(value); },
    end() { ended = true; },
  };

  // Use defineProperty instead of Object.assign so getters capture the live
  // closure variables (Bun's Object.assign with getters snapshots values).
  Object.defineProperty(response, 'statusCode', { get() { return statusCode; }, enumerable: true, configurable: true });
  Object.defineProperty(response, 'headers', { get() { return { ...headers }; }, enumerable: true, configurable: true });
  Object.defineProperty(response, 'body', { get() { return body; }, enumerable: true, configurable: true });
  Object.defineProperty(response, 'ended', { get() { return ended; }, enumerable: true, configurable: true });

  return response as DashboardTestResponse;
}
