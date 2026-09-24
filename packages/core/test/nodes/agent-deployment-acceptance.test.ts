import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AgentClient } from '../../src/nodes/agentClient.js';
import { AgentDeploymentAcceptance } from '../../src/nodes/agentAcceptance.js';
import type { NodeConfig } from '../../src/nodes/types.js';

const node: NodeConfig = { id: 'remote', name: 'Remote', host: 'remote.example', port: 3001, secret: 'node-secret', kernels: [], location: '', enabled: true };

describe('Agent deployment acceptance', () => {
  it('accepts the target version only after disconnect, stabilization and public HMAC health', async () => {
    const events: string[] = [];
    const client = new AgentClient({ now: () => 1234, fetch: (async (url, init) => {
      events.push('health');
      expect(events).toEqual(['disconnect', 'stable:2000', 'health']);
      expect(url).toBe('http://remote.example:3001/health');
      expect(init?.headers).toMatchObject({
        'X-Node-Id': 'remote', 'X-Timestamp': '1234',
        'X-Signature': createHmac('sha256', 'node-secret').update('1234\nGET\n/health\n').digest('hex'),
      });
      return Response.json({ status: 'healthy', version: '1.2.12' });
    }) as typeof fetch });
    const acceptance = new AgentDeploymentAcceptance(client, { wait: async milliseconds => { events.push(`stable:${milliseconds}`); } });

    await expect(acceptance.verify(node, '1.2.12', { disconnect: async () => { events.push('disconnect'); } }))
      .resolves.toMatchObject({ version: '1.2.12' });
  });

  it('reports a service that exits on SSH logout and retains redacted diagnostics', async () => {
    let connected = true;
    const acceptance = new AgentDeploymentAcceptance(new AgentClient({ fetch: (async () => {
      expect(connected).toBe(false);
      throw new Error('ECONNREFUSED');
    }) as typeof fetch }), { wait: async () => {} });
    await expect(acceptance.verify(node, '1.2.12', {
      disconnect: () => { connected = false; },
      diagnose: async () => ({ lingerEnabled: false, serviceState: 'inactive', journal: 'process exited node-secret password=ssh-password' }),
    })).rejects.toMatchObject({
      code: 'LINGER_DISABLED',
      diagnostics: { healthError: 'ECONNREFUSED', lingerEnabled: false, serviceState: 'inactive', journal: 'process exited [redacted] password=[redacted]' },
    });
  });

  it.each([
    { diagnostics: { serviceState: 'failed', journal: 'configuration rejected at line 12' }, code: 'SERVICE_NOT_STARTED' },
    { diagnostics: { serviceState: 'failed', portConflict: true, journal: 'listen EADDRINUSE :3001' }, code: 'PORT_CONFLICT' },
  ])('distinguishes $code after an unsuccessful public check', async ({ diagnostics, code }) => {
    const acceptance = new AgentDeploymentAcceptance(new AgentClient({ fetch: (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch }), { wait: async () => {} });
    await expect(acceptance.verify(node, '1.2.12', { disconnect() {}, diagnose: async () => diagnostics }))
      .rejects.toMatchObject({ code, diagnostics: { ...diagnostics, healthError: 'ECONNREFUSED' } });
  });

  it('rejects a healthy Agent still running the previous version', async () => {
    const acceptance = new AgentDeploymentAcceptance(new AgentClient({ fetch: (async () => Response.json({ status: 'healthy', version: '1.2.11' })) as typeof fetch }), { wait: async () => {} });
    await expect(acceptance.verify(node, '1.2.12', { disconnect() {} }))
      .rejects.toMatchObject({ code: 'VERSION_MISMATCH', message: expect.stringContaining('1.2.11') });
  });

  it('keeps a bounded public timeout and its error when diagnosis also fails', async () => {
    const acceptance = new AgentDeploymentAcceptance(new AgentClient({ fetch: (() => new Promise(() => {})) as typeof fetch }), { wait: async () => {}, timeoutMs: 10 });
    await expect(acceptance.verify(node, '1.2.12', { disconnect() {}, diagnose: async () => { throw new Error('SSH unavailable'); } }))
      .rejects.toMatchObject({ code: 'HEALTH_TIMEOUT', diagnostics: { healthError: '请求超时', diagnosticError: 'SSH unavailable' } });
  });

  it.each([null, { status: 'unhealthy', version: '1.2.12' }])('rejects invalid or unhealthy HTTP 200 responses', async health => {
    const acceptance = new AgentDeploymentAcceptance(new AgentClient({ fetch: (async () => Response.json(health)) as typeof fetch }), { wait: async () => {} });
    await expect(acceptance.verify(node, '1.2.12', { disconnect() {} })).rejects.toMatchObject({ code: 'UNHEALTHY' });
  });

  it('does not let stalled SSH diagnostics conceal the original health failure', async () => {
    const acceptance = new AgentDeploymentAcceptance(new AgentClient({ fetch: (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch }), { wait: async () => {}, diagnosticTimeoutMs: 10 });
    await expect(acceptance.verify(node, '1.2.12', { disconnect() {}, diagnose: () => new Promise(() => {}) }))
      .rejects.toMatchObject({ code: 'HEALTH_UNREACHABLE', diagnostics: { healthError: 'ECONNREFUSED', diagnosticError: 'SSH 诊断超时' } });
  });
});
