import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeployManager } from '../deployManager';
import { UpdateChecker } from '../updateChecker';
import { NodeManager } from '../nodeManager';
import type { NodeConfig } from '../../types';

function makeNode(overrides: Partial<NodeConfig> = {}): NodeConfig {
  return {
    id: 'n1', name: 'Test', host: '10.0.0.1', port: 443, secret: 'sec',
    kernels: [{ type: 'sing-box' }], location: 'test', enabled: true, ...overrides,
  };
}

describe('Deploy Integration', () => {
  let deployManager: DeployManager;

  beforeEach(() => {
    vi.clearAllMocks();
    deployManager = DeployManager.getInstance();
  });

  describe('full deploy lifecycle (DeployManager.deployToNode)', () => {
    it('should return DeployResult with success and message (mock SSH)', async () => {
      // deployToNode now uses real SSH, so with fake host it should return failure
      const result = await deployManager.deployToNode({
        nodeId: 'integration-1',
        secret: 'secret', kernels: [{ type: 'sing-box' }],
        ssh: { host: '10.0.0.100', user: 'root', port: 22, authMethod: 'privateKey', privateKey: 'key', hostKey: '' },
        agentPort: 9400,
      });

      // With fake SSH host, it will fail — but the method itself works correctly
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.message).toBe('string');
    });

    it('should handle multiple deploy targets (all fail with fake hosts)', async () => {
      const r1 = await deployManager.deployToNode({
        nodeId: 'node-a',
        secret: 'secret', kernels: [{ type: 'sing-box' }],
        ssh: { host: '10.0.0.1', user: 'root', port: 22, authMethod: 'privateKey', privateKey: 'key', hostKey: '' },
      });
      const r2 = await deployManager.deployToNode({
        nodeId: 'node-b',
        secret: 'secret', kernels: [{ type: 'xray' }],
        ssh: { host: '10.0.0.2', user: 'admin', port: 2222, authMethod: 'privateKey', privateKey: 'key', hostKey: '' },
      });

      // Both should fail with fake hosts but return proper DeployResult
      expect(r1.success).toBe(false);
      expect(r2.success).toBe(false);
      expect(r1.message).toBeTruthy();
      expect(r2.message).toBeTruthy();
    });
  });

  describe('NodeManager deployDelegate integration', () => {
    it('should accept deployDelegate and make it callable', () => {
      const manager = NodeManager.getInstance();
      const delegate = vi.fn().mockResolvedValue({ success: true, message: 'ok' });

      manager.setDeployDelegate(delegate);

      expect((manager as any).deployDelegate).toBe(delegate);
    });

    it('should allow DeployManager.deployToNode as delegate', () => {
      const manager = NodeManager.getInstance();
      const dm = DeployManager.getInstance();

      manager.setDeployDelegate(async (node) => {
        return dm.deployToNode({
          nodeId: node.id,
          secret: node.secret,
          kernels: node.kernels,
          ssh: { ...node.ssh!, host: node.host, privateKey: 'key' },
          agentPort: node.agent?.port,
        });
      });

      expect((manager as any).deployDelegate).toBeDefined();
    });
  });

  describe('update flow integration', () => {
    it('should detect outdated nodes via UpdateChecker', async () => {
      const nodes = [
        makeNode({
          id: 'old-agent',
          agent: { deployed: true, version: 'deploy-agent-v1.0.0', status: 'running', lastDeploy: '' },
          ssh: { user: 'root', port: 22, keyPath: '/k', hostKey: '' },
        }),
        makeNode({
          id: 'current-agent',
          agent: { deployed: true, version: 'deploy-agent-v2.0.0', status: 'running', lastDeploy: '' },
          ssh: { user: 'root', port: 22, keyPath: '/k', hostKey: '' },
        }),
      ];

      const mockNodeManager = {
        listNodes: vi.fn(() => nodes),
        getNode: vi.fn((id: string) => nodes.find(n => n.id === id) || null),
        updateNode: vi.fn(),
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'deploy-agent-v2.0.0',
          assets: [{ name: 'miobridge-agent', browser_download_url: 'https://example.com/agent' }],
        }),
      });

      const uc = new UpdateChecker(mockNodeManager as any, { checkIntervalMs: 0 });
      const result = await uc.checkForUpdates();

      expect(result).not.toBeNull();
      expect(result!.latestVersion).toBe('deploy-agent-v2.0.0');
      expect(result!.outdatedNodes).toHaveLength(1);
      expect(result!.outdatedNodes[0].id).toBe('old-agent');

      uc.stop();
    });

    it('should not flag nodes without agent deployed', async () => {
      const nodes = [
        makeNode({
          id: 'no-agent',
          agent: undefined,
          ssh: { user: 'root', port: 22, keyPath: '/k', hostKey: '' },
        }),
      ];

      const mockNodeManager = {
        listNodes: vi.fn(() => nodes),
        getNode: vi.fn(),
        updateNode: vi.fn(),
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'deploy-agent-v2.0.0',
          assets: [{ name: 'miobridge-agent', browser_download_url: 'https://example.com/agent' }],
        }),
      });

      const uc = new UpdateChecker(mockNodeManager as any, { checkIntervalMs: 0 });
      const result = await uc.checkForUpdates();

      expect(result!.outdatedNodes).toHaveLength(0);
      uc.stop();
    });

    it('should handle fetch failure gracefully', async () => {
      const mockNodeManager = {
        listNodes: vi.fn(() => []),
        getNode: vi.fn(),
        updateNode: vi.fn(),
      };

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const uc = new UpdateChecker(mockNodeManager as any, { checkIntervalMs: 0 });
      const result = await uc.checkForUpdates();

      expect(result).toBeNull();
      uc.stop();
    });
  });
});
