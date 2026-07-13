import { describe, it, expect, vi } from 'vitest';
import {
  parseDeployArgs,
  formatDeployStatus,
  handleDeployStatus,
  handleDeployUpdate,
  handleDeployRestart,
} from '../deploy-commands';
import type { NodeConfig } from '../../../types';

const sampleNodes: NodeConfig[] = [
  {
    id: 'node-1', name: 'US East', host: '10.0.0.1', port: 443, secret: 'k1',
    kernels: [{ type: 'sing-box' }], location: 'us', enabled: true,
    agent: { deployed: true, version: 'deploy-agent-v1.2.0', status: 'running', lastDeploy: '' },
    ssh: { user: 'root', port: 22, keyPath: '/key', hostKey: '' },
  },
  {
    id: 'node-2', name: 'EU West', host: '10.0.0.2', port: 443, secret: 'k2',
    kernels: [{ type: 'xray' }], location: 'eu', enabled: true,
    agent: { deployed: false, version: '', status: 'not_deployed', lastDeploy: '' },
    ssh: { user: 'root', port: 22, keyPath: '/key', hostKey: '' },
  },
  {
    id: 'node-3', name: 'Local', host: 'localhost', port: 3001, secret: '', kernels: [{ type: 'sing-box' }], location: 'local', enabled: true,
    agent: undefined,
  },
];

describe('parseDeployArgs', () => {
  it('status', () => expect(parseDeployArgs(['status'])).toEqual({ command: 'status' }));
  it('status <id>', () => expect(parseDeployArgs(['status', 'n1'])).toEqual({ command: 'status', nodeId: 'n1' }));
  it('update', () => expect(parseDeployArgs(['update'])).toEqual({ command: 'update' }));
  it('update <id>', () => expect(parseDeployArgs(['update', 'n1'])).toEqual({ command: 'update', nodeId: 'n1' }));
  it('restart-agent <id>', () => expect(parseDeployArgs(['restart-agent', 'n1'])).toEqual({ command: 'restart-agent', nodeId: 'n1' }));
  it('unknown command', () => expect(parseDeployArgs(['unknown'])).toBeNull());
  it('restart-agent without nodeId', () => expect(parseDeployArgs(['restart-agent'])).toBeNull());
});

describe('formatDeployStatus', () => {
  it('should format all nodes', () => {
    const out = formatDeployStatus(sampleNodes);
    expect(out).toContain('node-1');
    expect(out).toContain('US East');
    expect(out).toContain('running');
    expect(out).toContain('deploy-agent-v1.2.0');
    expect(out).toContain('node-2');
    expect(out).toContain('not_deployed');
  });

  it('should format single node', () => {
    const out = formatDeployStatus([sampleNodes[0]]);
    expect(out).toContain('node-1');
    expect(out).not.toContain('node-2');
  });

  it('should handle empty list', () => {
    expect(formatDeployStatus([])).toContain('No nodes');
  });
});

describe('handleDeployStatus', () => {
  it('should return all nodes when no nodeId', () => {
    const mgr = { listNodes: vi.fn(() => sampleNodes), getNode: vi.fn() };
    expect(handleDeployStatus(mgr as any, { command: 'status' })).toContain('node-1');
  });

  it('should return specific node', () => {
    const mgr = { listNodes: vi.fn(), getNode: vi.fn(() => sampleNodes[0]) };
    expect(handleDeployStatus(mgr as any, { command: 'status', nodeId: 'node-1' })).toContain('node-1');
  });

  it('should return error for missing node', () => {
    const mgr = { listNodes: vi.fn(), getNode: vi.fn(() => null) };
    expect(handleDeployStatus(mgr as any, { command: 'status', nodeId: 'x' })).toContain('not found');
  });
});

describe('handleDeployUpdate', () => {
  it('should show all up to date', async () => {
    const uc = { checkForUpdates: vi.fn(async () => ({ latestVersion: 'v2.0.0', outdatedNodes: [], outdatedCount: 0, downloadUrl: 'https://x.com' })) };
    const out = await handleDeployUpdate({} as any, uc as any, { command: 'update' });
    expect(out).toContain('v2.0.0');
    expect(out).toContain('up to date');
  });

  it('should show outdated nodes', async () => {
    const uc = { checkForUpdates: vi.fn(async () => ({ latestVersion: 'v2.0.0', outdatedNodes: [sampleNodes[0]], outdatedCount: 1, downloadUrl: 'https://x.com' })) };
    const out = await handleDeployUpdate({} as any, uc as any, { command: 'update' });
    expect(out).toContain('node-1');
    expect(out).toContain('outdated');
  });
});

describe('handleDeployRestart', () => {
  it('should error when node not found', async () => {
    const mgr = { getNode: vi.fn(() => null) };
    expect(await handleDeployRestart(mgr as any, { command: 'restart-agent', nodeId: 'x' })).toContain('not found');
  });

  it('should error when no SSH', async () => {
    const mgr = { getNode: vi.fn(() => sampleNodes[2]) };
    expect(await handleDeployRestart(mgr as any, { command: 'restart-agent', nodeId: 'node-3' })).toContain('SSH');
  });

  it('should return restart message', async () => {
    const mgr = { getNode: vi.fn(() => sampleNodes[0]) };
    const out = await handleDeployRestart(mgr as any, { command: 'restart-agent', nodeId: 'node-1' });
    expect(out).toContain('Restarting');
    expect(out).toContain('node-1');
  });
});
