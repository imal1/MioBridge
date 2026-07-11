// TDD RED phase for Task 3: NodeManager service
// These tests verify the NodeManager singleton, HMAC signing, node loading,
// and remote HTTP polling for multi-node cluster management

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import * as crypto from 'crypto';
import { utils as sshUtils } from 'ssh2';
import type { NodeConfig, NodeStatus } from '../../types';

const TEST_CONFIG_DIR = '/tmp/miobridge-node-manager-test-empty';

async function getTestNodeManager() {
  vi.stubEnv('MIOBRIDGE_CONFIG_DIR', TEST_CONFIG_DIR);
  const { NodeManager } = await import('../nodeManager');
  return NodeManager.getInstance();
}

async function writeTestNodesYaml(nodes: NodeConfig[]) {
  const fs = await import('fs-extra');
  const path = await import('path');
  await fs.ensureDir(TEST_CONFIG_DIR);
  const lines = ['nodes:'];
  for (const node of nodes) {
    lines.push(`  - id: "${node.id}"`);
    lines.push(`    name: "${node.name}"`);
    lines.push(`    host: "${node.host}"`);
    lines.push(`    port: ${node.port ?? 3001}`);
    lines.push(`    secret: "${node.secret}"`);
    lines.push(`    kernel: "${node.kernel}"`);
    lines.push(`    location: "${node.location}"`);
    lines.push(`    enabled: ${node.enabled}`);
  }
  await fs.writeFile(path.join(TEST_CONFIG_DIR, 'nodes.yaml'), `${lines.join('\n')}\n`);
}

function verifyHmac(req: IncomingMessage, secret: string): boolean {
  const timestamp = req.headers['x-timestamp'];
  const signature = req.headers['x-signature'];
  if (typeof timestamp !== 'string' || typeof signature !== 'string') return false;

  const payload = `${timestamp}\n${req.method || 'GET'}\n${req.url || '/'}\n`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return signature === expected;
}

async function startAgentStub(secret: string) {
  const requests: Array<{ url: string; nodeId?: string; signed: boolean }> = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const signed = verifyHmac(req, secret);
    requests.push({
      url: req.url || '/',
      nodeId: Array.isArray(req.headers['x-node-id']) ? req.headers['x-node-id'][0] : req.headers['x-node-id'],
      signed,
    });

    res.setHeader('Content-Type', 'application/json');
    if (!signed) {
      res.statusCode = 401;
      res.end(JSON.stringify({ success: false, error: 'unauthorized' }));
      return;
    }

    if (req.url === '/api/urls') {
      res.end(JSON.stringify({
        success: true,
        data: {
          urls: ['vless://00000000-0000-4000-8000-000000000001@example.com:443?type=tcp#remote-a'],
          nodesCount: 1,
          kernelAccessible: true,
        },
      }));
      return;
    }

    if (req.url === '/api/status') {
      res.end(JSON.stringify({
        success: true,
        data: {
          nodesCount: 1,
          subscriptionExists: false,
          clashExists: false,
          mihomoAvailable: true,
          singBoxAccessible: true,
          version: 'agent-test',
          uptime: 12,
        },
      }));
      return;
    }

    res.end(JSON.stringify({ success: true }));
  });

  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to start agent stub');

  return {
    port: address.port,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

describe('Task 3: NodeManager Service', () => {
  beforeEach(async () => {
    vi.stubEnv('MIOBRIDGE_CONFIG_DIR', TEST_CONFIG_DIR);
    vi.resetModules();
    const fs = await import('fs-extra');
    await fs.remove(TEST_CONFIG_DIR);
  });

  afterEach(async () => {
    const fs = await import('fs-extra');
    await fs.remove(TEST_CONFIG_DIR);
    vi.unstubAllEnvs();
  });

  describe('singleton', () => {
    it('getInstance should return the same instance', async () => {
      const instance1 = await getTestNodeManager();
      const instance2 = await getTestNodeManager();
      expect(instance1).toBe(instance2);
    });
  });

  describe('signRequest', () => {
    it('should return empty headers for localhost node', async () => {
      const manager = await getTestNodeManager();
      const localNode: NodeConfig = {
        id: 'local', name: '本地', host: 'localhost',
        secret: 'abc123', kernel: 'sing-box', location: '本地', enabled: true,
      };
      const headers = manager.signRequest(localNode, 'GET', '/api/status');
      expect(headers).toEqual({});
    });

    it('should return empty headers for 127.0.0.1 node', async () => {
      const manager = await getTestNodeManager();
      const localNode: NodeConfig = {
        id: 'local', name: '本地', host: '127.0.0.1', port: 3001,
        secret: 'abc123', kernel: 'sing-box', location: '本地', enabled: true,
      };
      const headers = manager.signRequest(localNode, 'GET', '/api/status');
      expect(headers).toEqual({});
    });

    it('should produce HMAC-SHA256 signature for remote node', async () => {
      const manager = await getTestNodeManager();
      const remoteNode: NodeConfig = {
        id: 'node-b', name: '新加坡', host: 'sg.example.com', port: 443,
        secret: 'supersecretkey1234567890abcdef', kernel: 'xray',
        location: '新加坡', enabled: true,
      };
      const headers = manager.signRequest(remoteNode, 'GET', '/api/status');

      expect(headers['X-Node-Id']).toBe('node-b');
      expect(headers['X-Timestamp']).toBeDefined();
      expect(headers['X-Signature']).toBeDefined();
      // Signature should be 64 hex chars (SHA-256)
      expect(headers['X-Signature']).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different signatures for different methods', async () => {
      const manager = await getTestNodeManager();
      const node: NodeConfig = {
        id: 'n1', name: 'N1', host: 'api.example.com', port: 443,
        secret: 'key123', kernel: 'sing-box', location: 'jp', enabled: true,
      };
      const getHeaders = manager.signRequest(node, 'GET', '/api/status');
      const postHeaders = manager.signRequest(node, 'POST', '/api/status');

      expect(getHeaders['X-Signature']).not.toBe(postHeaders['X-Signature']);
    });

    it('should produce different signatures for different paths', async () => {
      const manager = await getTestNodeManager();
      const node: NodeConfig = {
        id: 'n1', name: 'N1', host: 'api.example.com', port: 443,
        secret: 'key123', kernel: 'sing-box', location: 'jp', enabled: true,
      };
      const h1 = manager.signRequest(node, 'GET', '/api/status');
      const h2 = manager.signRequest(node, 'GET', '/api/health');

      expect(h1['X-Signature']).not.toBe(h2['X-Signature']);
    });

    it('should include request body in signature payload', async () => {
      const manager = await getTestNodeManager();
      const node: NodeConfig = {
        id: 'n1', name: 'N1', host: 'api.example.com', port: 443,
        secret: 'key123', kernel: 'sing-box', location: 'jp', enabled: true,
      };
      const withoutBody = manager.signRequest(node, 'POST', '/api/update');
      const withBody = manager.signRequest(node, 'POST', '/api/update', '{"action":"update"}');

      expect(withoutBody['X-Signature']).not.toBe(withBody['X-Signature']);
    });
  });

  describe('hasRemoteNodes', () => {
    it('should return false when no nodes.yaml exists (single-node mode)', async () => {
      const manager = await getTestNodeManager();
      // In test environment, nodes.yaml won't exist, so loadNodes returns []
      await manager.loadNodes();
      expect(manager.hasRemoteNodes()).toBe(false);
    });
  });

  describe('loadNodes', () => {
    it('should return empty array when nodes.yaml does not exist', async () => {
      const manager = await getTestNodeManager();
      const nodes = await manager.loadNodes();
      expect(Array.isArray(nodes)).toBe(true);
      // In test environment without nodes.yaml, should be empty
      expect(nodes.length).toBe(0);
    });
  });

  describe('SSH credential persistence', () => {
    it('stores an uploaded private key separately from nodes.yaml', async () => {
      const manager = await getTestNodeManager();
      const privateKey = sshUtils.generateKeyPairSync('ed25519').private;
      const saved = await manager.writeNodeWithPrivateKey({
        id: '', name: 'Private key node', host: 'key.example.com', secret: '',
        kernel: 'sing-box', location: 'test', enabled: true,
        ssh: { user: 'root', authMethod: 'privateKey', hostKey: '' },
      }, privateKey);
      const { getStateStore } = await import('../stateStore');

      expect(saved.ssh?.credentialRef).toBe(`ssh-keys/${saved.id}`);
      expect(JSON.stringify(saved)).not.toContain(privateKey);
      expect(await getStateStore().get(`ssh-keys/${saved.id}`)).toBe(privateKey);
      expect(await getStateStore().get('nodes.yaml')).not.toContain(privateKey);
    });

    it('does not create a key record for password authentication', async () => {
      const manager = await getTestNodeManager();
      const saved = await manager.writeNodeWithPrivateKey({
        id: '', name: 'Password node', host: 'password.example.com', secret: '',
        kernel: 'xray', location: 'test', enabled: true,
        ssh: { user: 'root', authMethod: 'password', hostKey: '', password: 'test-password' },
      });
      const { getStateStore } = await import('../stateStore');

      expect(saved.ssh?.credentialRef).toBeUndefined();
      expect(await getStateStore().listKeys('ssh-keys/')).toEqual([]);
    });

    it('restores an existing key when a duplicate node write fails', async () => {
      const manager = await getTestNodeManager();
      const originalKey = sshUtils.generateKeyPairSync('ed25519').private;
      const replacementKey = sshUtils.generateKeyPairSync('ed25519').private;
      const node = {
        id: 'node-duplicate', name: 'Original', host: 'original.example.com', secret: '',
        kernel: 'sing-box' as const, location: 'test', enabled: true,
        ssh: { user: 'root', authMethod: 'privateKey' as const, hostKey: '' },
      };
      await manager.writeNodeWithPrivateKey(node, originalKey);

      await expect(manager.writeNodeWithPrivateKey({
        ...node,
        name: 'Duplicate',
        ssh: { user: 'root', authMethod: 'privateKey', hostKey: '' },
      }, replacementKey)).rejects.toThrow('已存在');

      const { getStateStore } = await import('../stateStore');
      expect(await getStateStore().get('ssh-keys/node-duplicate')).toBe(originalKey);
    });
  });

  describe('getClusterStatus', () => {
    it('should return an empty remote cluster when no child nodes are configured', async () => {
      const manager = await getTestNodeManager();
      const cluster = await manager.getClusterStatus();
      expect(cluster.totalNodes).toBe(0);
      expect(cluster.onlineNodes).toBe(0);
      expect(cluster.totalProxies).toBe(0);
      expect(cluster.nodes).toEqual([]);
      expect(cluster.lastUpdated).toBeDefined();
    });

    it('should not include a local control-plane node in cluster nodes', async () => {
      const manager = await getTestNodeManager();
      const cluster = await manager.getClusterStatus();
      const localNode = cluster.nodes.find(n => n.nodeId === 'local');
      expect(localNode).toBeUndefined();
    });
  });

  describe('triggerUpdate', () => {
    it('should return results object', async () => {
      const manager = await getTestNodeManager();
      const result = await manager.triggerUpdate();
      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
      expect(typeof result.results).toBe('object');
    });
  });

  describe('healthCheck', () => {
    it('should return health status for all nodes', async () => {
      const manager = await getTestNodeManager();
      const result = await manager.healthCheck();
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  // ==================== v1.0 Remote HTTP Polling (RED phase) ====================

  describe('fetchRemoteStatus', () => {
    const remoteNode: NodeConfig = {
      id: 'node-sg', name: '新加坡', host: 'sg.example.com', port: 443,
      secret: 'shared-secret-32chars-minimum!!', kernel: 'xray',
      location: '新加坡', enabled: true,
    };

    it('should return NodeStatus for a remote node', async () => {
      const manager = await getTestNodeManager();
      // fetchRemoteStatus should exist
      expect(typeof (manager as any).fetchRemoteStatus).toBe('function');
    });

    it('should mark node as offline when fetch fails', async () => {
      const manager = await getTestNodeManager();
      // When node is unreachable, should return status with online=false and error
      // This test validates the failure handling contract
      const result = await (manager as any).fetchRemoteStatus({
        ...remoteNode,
        host: 'unreachable.example.com',
      });
      expect(result).toBeDefined();
      expect(result.online).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.nodeId).toBe(remoteNode.id);
    });

    it('should include HMAC headers in remote request', async () => {
      const manager = await getTestNodeManager();
      const headers = manager.signRequest(remoteNode, 'GET', '/api/status');
      expect(headers['X-Node-Id']).toBe('node-sg');
      expect(headers['X-Timestamp']).toBeDefined();
      expect(headers['X-Signature']).toBeDefined();
    });
  });

  describe('fetchRemoteUpdate', () => {
    const remoteNode: NodeConfig = {
      id: 'node-jp', name: '东京', host: 'jp.example.com', port: 443,
      secret: 'jp-secret-key-32chars-minimum!', kernel: 'sing-box',
      location: '东京', enabled: true,
    };

    it('should return update result for remote node', async () => {
      const manager = await getTestNodeManager();
      expect(typeof (manager as any).fetchRemoteUpdate).toBe('function');
    });

    it('should return failure when remote node is unreachable', async () => {
      const manager = await getTestNodeManager();
      const result = await (manager as any).fetchRemoteUpdate({
        ...remoteNode,
        host: 'offline.example.com',
      });
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.message).toContain('离线');
    });
  });

  describe('fetchRemoteHealth', () => {
    const remoteNode: NodeConfig = {
      id: 'node-hk', name: '香港', host: 'hk.example.com', port: 443,
      secret: 'hk-secret-key-32chars-minimum!!', kernel: 'v2ray',
      location: '香港', enabled: true,
    };

    it('should return latency measurement for remote node', async () => {
      const manager = await getTestNodeManager();
      expect(typeof (manager as any).fetchRemoteHealth).toBe('function');
    });

    it('should report online=false with zero latency when unreachable', async () => {
      const manager = await getTestNodeManager();
      const result = await (manager as any).fetchRemoteHealth({
        ...remoteNode,
        host: 'dead.example.com',
      });
      expect(result).toBeDefined();
      expect(result.online).toBe(false);
      expect(result.latency).toBe(0);
    });
  });

  describe('getClusterStatus (multi-node)', () => {
    it('should aggregate only remote child node statuses', async () => {
      const secret = 'distributed-secret-32chars-minimum';
      const agent = await startAgentStub(secret);
      const manager = await getTestNodeManager();

      try {
        await writeTestNodesYaml([{
          id: 'remote-agent',
          name: 'Remote Agent',
          host: '0.0.0.0',
          port: agent.port,
          secret,
          kernel: 'xray',
          location: 'loopback',
          enabled: true,
        }]);

        const cluster = await manager.getClusterStatus();
        expect(cluster.totalNodes).toBe(1);
        expect(cluster.onlineNodes).toBe(1);
        expect(cluster.nodes.map((node: NodeStatus) => node.nodeId)).toEqual(['remote-agent']);
        expect(cluster.nodes.find((n: NodeStatus) => n.nodeId === 'local')).toBeUndefined();
      } finally {
        await agent.close();
      }
    });

    it('should handle remote node offline without failing entire cluster', async () => {
      const manager = await getTestNodeManager();
      const cluster = await manager.getClusterStatus();
      // All nodes should appear, even if offline
      expect(cluster.nodes.length).toBe(cluster.totalNodes);
    });

    it('should return lastUpdated timestamp', async () => {
      const manager = await getTestNodeManager();
      const cluster = await manager.getClusterStatus();
      expect(cluster.lastUpdated).toBeDefined();
      expect(() => new Date(cluster.lastUpdated)).not.toThrow();
    });
  });

  describe('control plane to remote Agent interaction', () => {
    it('should call remote Agent URLs and status endpoints with HMAC and aggregate results', async () => {
      const secret = 'distributed-secret-32chars-minimum';
      const agent = await startAgentStub(secret);
      const manager = await getTestNodeManager();

      try {
        await writeTestNodesYaml([{
          id: 'remote-agent',
          name: 'Remote Agent',
          host: '0.0.0.0',
          port: agent.port,
          secret,
          kernel: 'xray',
          location: 'loopback',
          enabled: true,
        }]);

        const remoteUrls = await manager.collectRemoteNodeUrls();
        expect(remoteUrls.errors).toEqual([]);
        expect(remoteUrls.urls).toEqual([
          'vless://00000000-0000-4000-8000-000000000001@example.com:443?type=tcp#remote-a',
        ]);

        const cluster = await manager.getClusterStatus();
        const remoteNode = cluster.nodes.find((node: NodeStatus) => node.nodeId === 'remote-agent');
        expect(remoteNode).toBeDefined();
        expect(remoteNode!.online).toBe(true);
        expect(remoteNode!.nodesCount).toBe(1);

        expect(agent.requests).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ url: '/api/urls', nodeId: 'remote-agent', signed: true }),
            expect.objectContaining({ url: '/api/status', nodeId: 'remote-agent', signed: true }),
          ]),
        );
      } finally {
        await agent.close();
      }
    }, 10_000);
  });

  describe('triggerUpdate (multi-node)', () => {
    it('should support updating a specific remote node by id', async () => {
      const manager = await getTestNodeManager();
      // triggerUpdate should accept nodeId parameter
      const result = await manager.triggerUpdate('node-sg');
      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
    });

    it('should return per-node success/failure status', async () => {
      const manager = await getTestNodeManager();
      const result = await manager.triggerUpdate();
      for (const [, nodeResult] of Object.entries(result.results)) {
        expect(typeof nodeResult.success).toBe('boolean');
        expect(typeof nodeResult.message).toBe('string');
      }
    });
  });

  describe('healthCheck (multi-node)', () => {
    it('should not check local control-plane health when no child nodes exist', async () => {
      const manager = await getTestNodeManager();
      const result = await manager.healthCheck();
      expect(result).toEqual({});
    });

    it('should check health for specific remote node', async () => {
      const manager = await getTestNodeManager();
      const result = await manager.healthCheck('node-hk');
      expect(result).toBeDefined();
      expect(result['node-hk']).toBeDefined();
      expect(typeof result['node-hk'].online).toBe('boolean');
      expect(typeof result['node-hk'].latency).toBe('number');
    });
  });
});
