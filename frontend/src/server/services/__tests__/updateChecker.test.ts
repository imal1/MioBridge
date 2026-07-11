import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UpdateChecker } from '../updateChecker';
import type { NodeConfig } from '../../types';

function makeNode(overrides: Partial<NodeConfig> = {}): NodeConfig {
  return {
    id: 'n1',
    name: 'Test',
    host: '10.0.0.1',
    port: 443,
    secret: 'sec',
    kernels: [{ type: 'sing-box' }],
    location: 'test',
    enabled: true,
    ...overrides,
  };
}

function createMockNodeManager(nodes: NodeConfig[] = []) {
  const nodeMap = new Map(nodes.map((n) => [n.id, { ...n }]));
  return {
    listNodes: vi.fn(() => Array.from(nodeMap.values())),
    getNode: vi.fn((id: string) => nodeMap.get(id) || null),
    updateNode: vi.fn((id: string, u: Partial<NodeConfig>) => {
      const n = nodeMap.get(id);
      if (n) { Object.assign(n, u); return n; }
      return null;
    }),
  };
}

describe('UpdateChecker', () => {
  let updateChecker: UpdateChecker;
  let mockNodeManager: ReturnType<typeof createMockNodeManager>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockNodeManager = createMockNodeManager();
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
  });

  afterEach(() => {
    updateChecker?.stop();
  });

  describe('checkForUpdates', () => {
    it('should return latest version from GitHub Releases', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tag_name: 'deploy-agent-v1.2.0',
          assets: [{ name: 'miobridge-agent', browser_download_url: 'https://github.com/imal1/MioBridge/releases/download/deploy-agent-v1.2.0/miobridge-agent' }],
        }),
      });

      updateChecker = new UpdateChecker(mockNodeManager as any, { checkIntervalMs: 0 });
      const result = await updateChecker.checkForUpdates();

      expect(result!.latestVersion).toBe('deploy-agent-v1.2.0');
    });

    it('should return null when GitHub API fails', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });
      updateChecker = new UpdateChecker(mockNodeManager as any, { checkIntervalMs: 0 });
      expect(await updateChecker.checkForUpdates()).toBeNull();
    });

    it('should return null when no agent asset found', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ tag_name: 'v1.0.0', assets: [] }) });
      updateChecker = new UpdateChecker(mockNodeManager as any, { checkIntervalMs: 0 });
      expect(await updateChecker.checkForUpdates()).toBeNull();
    });

    it('should identify outdated nodes by agent.version', async () => {
      const nodes = [
        makeNode({ id: 'old', agent: { deployed: true, version: 'deploy-agent-v1.0.0', status: 'running', lastDeploy: '' }, ssh: { user: 'root', port: 22, keyPath: '/k', hostKey: '' } }),
        makeNode({ id: 'current', agent: { deployed: true, version: 'deploy-agent-v1.2.0', status: 'running', lastDeploy: '' }, ssh: { user: 'root', port: 22, keyPath: '/k', hostKey: '' } }),
        makeNode({ id: 'no-agent' }),
      ];
      mockNodeManager = createMockNodeManager(nodes);

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tag_name: 'deploy-agent-v1.2.0', assets: [{ name: 'miobridge-agent', browser_download_url: 'https://x.com/a' }] }),
      });

      updateChecker = new UpdateChecker(mockNodeManager as any, { checkIntervalMs: 0 });
      const result = await updateChecker.checkForUpdates();

      expect(result!.outdatedNodes).toHaveLength(1);
      expect(result!.outdatedNodes[0].id).toBe('old');
    });

    it('should skip nodes without SSH', async () => {
      const nodes = [makeNode({ id: 'no-ssh', agent: { deployed: true, version: 'v1.0.0', status: 'running', lastDeploy: '' } })];
      mockNodeManager = createMockNodeManager(nodes);

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tag_name: 'deploy-agent-v2.0.0', assets: [{ name: 'miobridge-agent', browser_download_url: 'https://x.com/a' }] }),
      });

      updateChecker = new UpdateChecker(mockNodeManager as any, { checkIntervalMs: 0 });
      const result = await updateChecker.checkForUpdates();
      expect(result!.outdatedNodes).toHaveLength(0);
    });

    it('should emit updateAvailable when outdated nodes found', async () => {
      const nodes = [makeNode({ id: 'old', agent: { deployed: true, version: 'v1.0.0', status: 'running', lastDeploy: '' }, ssh: { user: 'root', port: 22, keyPath: '/k', hostKey: '' } })];
      mockNodeManager = createMockNodeManager(nodes);

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tag_name: 'deploy-agent-v2.0.0', assets: [{ name: 'miobridge-agent', browser_download_url: 'https://x.com/a' }] }),
      });

      updateChecker = new UpdateChecker(mockNodeManager as any, { checkIntervalMs: 0 });
      const spy = vi.fn();
      updateChecker.on('updateAvailable', spy);

      await updateChecker.checkForUpdates();
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ latestVersion: 'deploy-agent-v2.0.0', outdatedCount: 1 }));
    });
  });

  describe('lifecycle', () => {
    it('should start and stop without errors', () => {
      updateChecker = new UpdateChecker(mockNodeManager as any, { checkIntervalMs: 3600000 });
      expect(updateChecker['isRunning']).toBe(false);
      updateChecker.start();
      expect(updateChecker['isRunning']).toBe(true);
      updateChecker.stop();
      expect(updateChecker['isRunning']).toBe(false);
    });

    it('should not double-start', () => {
      updateChecker = new UpdateChecker(mockNodeManager as any, { checkIntervalMs: 100 });
      updateChecker.start();
      const t1 = updateChecker['timer'];
      updateChecker.start();
      expect(updateChecker['timer']).toBe(t1);
      updateChecker.stop();
    });
  });
});
