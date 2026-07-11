// TDD RED phase for Phase C: SSE Cluster Events endpoint
// Tests verify the /api/cluster/events SSE endpoint

import { describe, it, expect, beforeEach, vi } from 'vitest';

const getClusterStatus = vi.hoisted(() => vi.fn(async () => ({
  totalNodes: 0,
  onlineNodes: 0,
  totalProxies: 0,
  nodes: [],
  lastUpdated: new Date(0).toISOString(),
})));

vi.mock('@/server/services/nodeManager', () => ({
  NodeManager: { getInstance: () => ({ getClusterStatus }) },
}));

// The module doesn't exist yet — import will fail until GREEN phase
let eventsHandler: any;

function mockReq(overrides: Record<string, any> = {}) {
  return {
    method: 'GET',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    on(_event: string, _cb: Function) {
      // no-op: client disconnect handler
      return this;
    },
    ...overrides,
  };
}

function mockRes() {
  const res: any = {
    _status: 200,
    _headers: {} as Record<string, string>,
    _chunks: [] as string[],
    _ended: false,
    status(code: number) {
      this._status = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this._headers[name] = value;
      return this;
    },
    write(chunk: string) {
      this._chunks.push(chunk);
      return true;
    },
    end() {
      this._ended = true;
      return this;
    },
    flush() {
      return;
    },
    on(_event: string, _cb: Function) {
      return this;
    },
    removeListener(_event: string, _cb: Function) {
      return this;
    },
  };
  return res;
}

describe('Phase C: SSE Cluster Events Endpoint', () => {
  beforeEach(async () => {
    // Dynamic import — will fail if file doesn't exist yet (expected RED)
    try {
      const mod = await import('@/pages/api/cluster/events');
      eventsHandler = mod.default;
    } catch {
      eventsHandler = undefined;
    }
  });

  describe('GET /api/cluster/events', () => {
    it('should be a function (handler exists)', () => {
      expect(typeof eventsHandler).toBe('function');
    });

    it('should set Content-Type to text/event-stream', async () => {
      const req = mockReq();
      const res = mockRes();
      await eventsHandler(req, res);
      expect(res._headers['Content-Type']).toBe('text/event-stream');
      expect(res._headers['Cache-Control']).toBe('no-cache');
      expect(res._headers['Connection']).toBe('keep-alive');
    });

    it('should send SSE-formatted data with cluster status', async () => {
      const req = mockReq();
      const res = mockRes();
      await eventsHandler(req, res);
      // Should have sent at least one SSE event
      const combined = res._chunks.join('');
      expect(combined).toContain('data:');
      // Should contain cluster fields
      expect(combined).toContain('totalNodes');
    });

    it('should send heartbeat comment to keep connection alive', async () => {
      const req = mockReq();
      const res = mockRes();
      await eventsHandler(req, res);
      const combined = res._chunks.join('');
      // SSE comment starts with ":"
      expect(combined).toContain(':');
    });
  });
});
