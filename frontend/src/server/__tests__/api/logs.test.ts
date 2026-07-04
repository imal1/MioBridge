import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRemoteLogs = vi.fn();
const getClusterStatus = vi.fn();

vi.mock('@/server/services/nodeManager', () => ({
  NodeManager: {
    getInstance: () => ({
      getRemoteLogs,
      getClusterStatus,
    }),
  },
}));

function mockRes() {
  const res: any = {
    _status: 200,
    _json: null,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(data: any) {
      this._json = data;
      return this;
    },
  };
  return res;
}

describe('GET /api/logs', () => {
  beforeEach(() => {
    getRemoteLogs.mockReset();
    getClusterStatus.mockReset();
  });

  it('should require a child node id instead of reading local logs', async () => {
    const { default: handler } = await import('@/pages/api/logs');
    const req: any = { method: 'GET', query: {} };
    const res = mockRes();

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._json.success).toBe(false);
    expect(getRemoteLogs).not.toHaveBeenCalled();
  });

  it('should proxy log requests to the selected child node', async () => {
    getRemoteLogs.mockResolvedValue({
      file: 'journalctl',
      files: ['journalctl'],
      lines: ['agent ready'],
      updatedAt: '2026-07-04T00:00:00.000Z',
      nodeId: 'node-sg',
      nodeName: '新加坡',
    });

    const { default: handler } = await import('@/pages/api/logs');
    const req: any = { method: 'GET', query: { node: 'node-sg', file: 'journalctl', level: 'info', q: 'agent' } };
    const res = mockRes();

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    expect(res._json.data.lines).toEqual(['agent ready']);
    expect(getRemoteLogs).toHaveBeenCalledWith('node-sg', {
      file: 'journalctl',
      level: 'info',
      query: 'agent',
    });
  });
});
