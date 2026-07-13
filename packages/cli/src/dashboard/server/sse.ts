import type { DashboardResponse } from './http.js';

/**
 * Framework-agnostic SSE helper for the CLI dashboard server.
 *
 * Mirrors the Next.js SSE contract from `frontend/src/pages/api/cluster/events.ts`:
 * - Content-Type: text/event-stream
 * - Cache-Control: no-cache
 * - Connection: keep-alive
 * - Initial heartbeat comment
 * - Periodic data events at 30s interval
 * - Cleanup on request close
 */
export interface SseConnection {
  /** Send a data event (JSON-serialised). */
  send(data: unknown): void;
  /** Send a heartbeat comment. */
  heartbeat(): void;
  /** Close the connection and release resources. */
  close(): void;
}

export function createSseConnection(
  res: DashboardResponse,
  onClose?: () => void,
): SseConnection {
  res.header('Content-Type', 'text/event-stream');
  res.header('Cache-Control', 'no-cache');
  res.header('Connection', 'keep-alive');

  let closed = false;
  let interval: ReturnType<typeof setInterval> | undefined;

  function send(data: unknown): void {
    if (closed) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  function heartbeat(): void {
    if (closed) return;
    res.write(': heartbeat\n\n');
  }

  function close(): void {
    if (closed) return;
    closed = true;
    if (interval) clearInterval(interval);
    onClose?.();
    res.end();
  }

  return { send, heartbeat, close };
}
