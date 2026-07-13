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
  process.env.MIOBRIDGE_CONFIG_DIR = TEST_CONFIG_DIR;
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
    lines.push('    kernels:');
    for (const kernel of node.kernels) {
      lines.push(`      - type: "${kernel.type}"`);
      if (kernel.configPath) lines.push(`        configPath: "${kernel.configPath}"`);
    }
    lines.push(`    location: "${node.location}"`);
    lines.push(`    enabled: ${node.enabled}`);
  }
  await fs.writeFile(path.join(TEST_CONFIG_DIR, 'nodes.yaml'), `${lines.join('\n')}\n`);
}

async function writeRawNodesYaml(raw: string) {
  const fs = await import('fs-extra');
  const path = await import('path');
  await fs.ensureDir(TEST_CONFIG_DIR);
  await fs.writeFile(path.join(TEST_CONFIG_DIR, 'nodes.yaml'), raw);
}

function verifyHmac(req: IncomingMessage, secret: string): boolean {
  const timestamp = req.headers['x-timestamp'];
  const signature = req.headers['x-signature'];
  if (typeof timestamp !== 'string' || typeof signature !== 'string') return false;

  const payload = `${timestamp}\n${req.method || 'GET'}\n${req.url || '/'}\n`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return signature === expected;
}

function defaultUrlsData() {
  return {
    sources: [
      { kernel: 'v2ray', url: 'trojan://secret@v2ray.example.com:443#remote-v2ray' },
      { kernel: 'xray', url: 'vless://00000000-0000-4000-8000-000000000001@example.com:443?type=tcp#remote-a' },
    ],
    kernels: [
      { type: 'sing-box', detected: true, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
      { type: 'xray', detected: true, monitored: true, accessible: true, nodesCount: 1, configPaths: ['/etc/xray/config.json'] },
      { type: 'v2ray', detected: true, monitored: true, accessible: true, nodesCount: 1, configPaths: ['/etc/v2ray/config.json'] },
    ],
  };
}

async function startAgentStub(secret: string, urlsData: unknown = defaultUrlsData()) {
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
        data: urlsData,
      }));
      return;
    }

    if (req.url === '/api/status') {
      res.end(JSON.stringify({
        success: true,
        data: {
          kernels: [
            { type: 'sing-box', detected: true, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
            { type: 'xray', detected: true, monitored: true, accessible: true, nodesCount: 1, configPaths: ['/etc/xray/config.json'] },
            { type: 'v2ray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
          ],
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
    vi.restoreAllMocks();
    process.env.MIOBRIDGE_CONFIG_DIR = TEST_CONFIG_DIR;
    const fs = await import('fs-extra');
    await fs.remove(TEST_CONFIG_DIR);
  });

  afterEach(async () => {
    const fs = await import('fs-extra');
    await fs.remove(TEST_CONFIG_DIR);
    delete process.env.MIOBRIDGE_CONFIG_DIR;
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
        secret: 'abc123', kernels: [{ type: 'sing-box' }], location: '本地', enabled: true,
      };
      const headers = manager.signRequest(localNode, 'GET', '/api/status');
      expect(headers).toEqual({});
    });

    it('should return empty headers for 127.0.0.1 node', async () => {
      const manager = await getTestNodeManager();
      const localNode: NodeConfig = {
        id: 'local', name: '本地', host: '127.0.0.1', port: 3001,
        secret: 'abc123', kernels: [{ type: 'sing-box' }], location: '本地', enabled: true,
      };
      const headers = manager.signRequest(localNode, 'GET', '/api/status');
      expect(headers).toEqual({});
    });

    it('should produce HMAC-SHA256 signature for remote node', async () => {
      const manager = await getTestNodeManager();
      const remoteNode: NodeConfig = {
        id: 'node-b', name: '新加坡', host: 'sg.example.com', port: 443,
        secret: 'supersecretkey1234567890abcdef', kernels: [{ type: 'xray' }],
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
        secret: 'key123', kernels: [{ type: 'sing-box' }], location: 'jp', enabled: true,
      };
      const getHeaders = manager.signRequest(node, 'GET', '/api/status');
      const postHeaders = manager.signRequest(node, 'POST', '/api/status');

      expect(getHeaders['X-Signature']).not.toBe(postHeaders['X-Signature']);
    });

    it('should produce different signatures for different paths', async () => {
      const manager = await getTestNodeManager();
      const node: NodeConfig = {
        id: 'n1', name: 'N1', host: 'api.example.com', port: 443,
        secret: 'key123', kernels: [{ type: 'sing-box' }], location: 'jp', enabled: true,
      };
      const h1 = manager.signRequest(node, 'GET', '/api/status');
      const h2 = manager.signRequest(node, 'GET', '/api/health');

      expect(h1['X-Signature']).not.toBe(h2['X-Signature']);
    });

    it('should include request body in signature payload', async () => {
      const manager = await getTestNodeManager();
      const node: NodeConfig = {
        id: 'n1', name: 'N1', host: 'api.example.com', port: 443,
        secret: 'key123', kernels: [{ type: 'sing-box' }], location: 'jp', enabled: true,
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

    it('round-trips a multi-kernel YAML sequence with custom config paths', async () => {
      const manager = await getTestNodeManager();
      const expected = {
        id: 'node-hk', name: '香港', host: 'hk.example.com', port: 3001,
        secret: 'shared-secret',
        kernels: [{ type: 'sing-box' as const }, { type: 'xray' as const, configPath: '/custom/xray.json' }],
        location: '香港', enabled: true,
        agent: { deployed: false, version: '', status: 'not_deployed' as const, lastDeploy: '' },
      };

      await manager.writeNodeToYaml({ ...expected, kernels: [...expected.kernels] });
      const loaded = await manager.loadNodes({ triggerDeploy: false });
      expect(loaded).toEqual([expected]);

      const { getStateStore } = await import('../stateStore');
      const yaml = await getStateStore().get('nodes.yaml');
      expect(yaml).toContain('    kernels:\n      - type: "sing-box"\n      - type: "xray"\n        configPath: "/custom/xray.json"');
      expect(yaml).not.toMatch(/^\s*kernel:/m);
    });

    it('round-trips an undeployed node with no committed monitored kernels', async () => {
      const manager = await getTestNodeManager();
      await manager.writeNodeToYaml({
        id: 'node-draft', name: 'Draft', host: 'draft.example.com', port: 3001,
        secret: 'secret', kernels: [], location: 'JP', enabled: true,
        agent: { deployed: false, version: '', status: 'not_deployed', lastDeploy: '' },
      });

      const loaded = await manager.loadNodes({ triggerDeploy: false });
      expect(loaded[0].kernels).toEqual([]);
      const { getStateStore } = await import('../stateStore');
      expect(await getStateStore().get('nodes.yaml')).toContain('    kernels: []');
    });

    it('does not auto-deploy a draft node with no committed monitored kernels', async () => {
      const manager = await getTestNodeManager();
      await manager.writeNodeToYaml({
        id: 'node-draft', name: 'Draft', host: 'draft.example.com', port: 3001,
        secret: 'secret', kernels: [], location: 'JP', enabled: true,
        ssh: { user: 'root', authMethod: 'password', password: 'secret' },
        agent: { deployed: false, version: '', status: 'not_deployed', lastDeploy: '' },
      });
      const deploy = vi.fn().mockResolvedValue({ success: true, message: 'ok' });
      manager.setDeployDelegate(deploy);

      try {
        await manager.loadNodes();
        expect(deploy).not.toHaveBeenCalled();
      } finally {
        (manager as any).deployDelegate = null;
      }
    });

    it('commits deployment results only for the current generation', async () => {
      const manager = await getTestNodeManager();
      await manager.writeNodeToYaml({
        id: 'node-cas', name: 'CAS', host: 'cas.example.com', port: 3001,
        secret: 'secret', kernels: [], location: 'SG', enabled: true,
        agent: { deployed: false, version: '', status: 'not_deployed', lastDeploy: '' },
      });
      await manager.beginDeployment('node-cas', 'deploy-a');
      await manager.beginDeployment('node-cas', 'deploy-b');

      expect(await manager.completeDeploymentIfCurrent('node-cas', 'deploy-a', {
        kernels: [{ type: 'sing-box' }],
        agent: { deployed: true, status: 'running' },
      })).toBe(false);
      expect(await manager.completeDeploymentIfCurrent('node-cas', 'deploy-b', {
        kernels: [{ type: 'xray' }],
        agent: { deployed: true, status: 'running' },
      })).toBe(true);

      const [loaded] = await manager.loadNodes({ triggerDeploy: false });
      expect(loaded.kernels).toEqual([{ type: 'xray' }]);
      expect(loaded.agent).toEqual(expect.objectContaining({
        deploymentId: 'deploy-b', deployed: true, status: 'running',
      }));
    });

    it('round-trips quoted and multiline node strings without injecting YAML keys', async () => {
      const manager = await getTestNodeManager();
      const injected = 'value"\n    injected: true\n  - id: attacker';
      const password = 'pa"ss\'word\nnew: key';
      const expected = {
        id: `node-${injected}`,
        name: `name-${injected}`,
        host: `host-${injected}`,
        port: 3001,
        secret: `token-${injected}`,
        kernels: [{ type: 'sing-box' as const }],
        location: `location-${injected}`,
        enabled: true,
        ssh: {
          user: `user-${injected}`,
          authMethod: 'password' as const,
          hostKey: `host-key-${injected}`,
          password,
        },
        agent: { deployed: false, version: '', status: 'not_deployed' as const, lastDeploy: '' },
      };

      await manager.writeNodeToYaml({ ...expected, kernels: [...expected.kernels] });
      const loaded = await manager.loadNodes({ triggerDeploy: false });
      expect(loaded).toEqual([expected]);

      const { getStateStore } = await import('../stateStore');
      const yaml = await getStateStore().get('nodes.yaml');
      expect(yaml?.match(/^\s+injected:/gm)).toBeNull();
      expect(yaml?.match(/^\s+- id: attacker$/gm)).toBeNull();
      expect(yaml).toContain(JSON.stringify(password));
    });

    it('normalizes YAML kernels into supported-kernel order', async () => {
      await writeTestNodesYaml([{
        id: 'ordered', name: 'Ordered', host: 'ordered.example.com', port: 3001,
        secret: 'secret', kernels: [{ type: 'v2ray' }, { type: 'sing-box' }], location: 'test', enabled: true,
      }]);
      const manager = await getTestNodeManager();
      expect((await manager.loadNodes())[0].kernels).toEqual([{ type: 'sing-box' }, { type: 'v2ray' }]);
    });

    it.each([
      ['legacy scalar', '    kernel: sing-box\n', '至少选择一个内核'],
      ['missing kernels', '', '至少选择一个内核'],
      ['empty kernels', '    kernels:\n', '至少选择一个内核'],
      ['duplicate kernels', '    kernels:\n      - type: xray\n      - type: xray\n', '内核类型重复: xray'],
      ['unsupported kernel', '    kernels:\n      - type: clash\n', '不支持的内核类型: clash'],
    ])('rejects %s YAML instead of treating it as no nodes', async (_name, kernelYaml, message) => {
      await writeRawNodesYaml(`nodes:\n  - id: broken\n    name: Broken\n    host: broken.example.com\n${kernelYaml}    location: test\n    enabled: true\n`);
      const manager = await getTestNodeManager();
      await expect(manager.loadNodes()).rejects.toThrow(message);
    });

    it('preserves the last loaded nodes after a schema error', async () => {
      const manager = await getTestNodeManager();
      await writeTestNodesYaml([{
        id: 'valid', name: 'Valid', host: 'valid.example.com', secret: 'secret',
        kernels: [{ type: 'sing-box' }], location: 'test', enabled: true,
      }]);
      await manager.loadNodes();
      await writeRawNodesYaml('nodes:\n  - id: broken\n    kernel: sing-box\n');

      await expect(manager.loadNodes()).rejects.toThrow('至少选择一个内核');
      expect(manager.hasRemoteNodes()).toBe(true);
    });

    it.each([
      ['unknown field', '      - type: xray\n        typo: true\n'],
      ['wrong list indentation', '     - type: xray\n'],
      ['wrong property indentation', '      - type: xray\n       configPath: /custom/xray.json\n'],
      ['property without item', '        configPath: /custom/xray.json\n'],
      ['inline object', '    kernels: {}\n'],
      ['duplicate type property', '      - type: xray\n        type: v2ray\n'],
      ['duplicate configPath', '      - type: xray\n        configPath: /one.json\n        configPath: /two.json\n'],
      ['tagged type', '      - type: !!seq []\n'],
      ['anchored type', '      - type: &kernel xray\n'],
      ['aliased type', '      - type: *kernel\n'],
      ['tagged configPath', '      - type: xray\n        configPath: !!str /custom/xray.json\n'],
      ['anchored configPath', '      - type: xray\n        configPath: &paths /custom/xray.json\n'],
      ['aliased configPath', '      - type: xray\n        configPath: *paths\n'],
    ])('strictly rejects kernels YAML with %s', async (_name, kernelYaml) => {
      await writeRawNodesYaml(`nodes:\n  - id: broken\n    name: Broken\n    host: broken.example.com\n${kernelYaml.startsWith('    kernels:') ? kernelYaml : `    kernels:\n${kernelYaml}`}    location: test\n    enabled: true\n`);
      const manager = await getTestNodeManager();
      await expect(manager.loadNodes()).rejects.toThrow();
    });

    it('rejects a duplicate node-level kernels mapping key', async () => {
      await writeRawNodesYaml(`nodes:
  - id: broken
    name: Broken
    host: broken.example.com
    kernels:
      - type: sing-box
    kernels:
      - type: xray
    location: test
    enabled: true
`);
      const manager = await getTestNodeManager();
      await expect(manager.loadNodes()).rejects.toThrow('kernels 字段重复');
    });

    it('does not append when the existing YAML is invalid', async () => {
      const raw = 'nodes:\n  - id: broken\n    kernel: sing-box\n';
      await writeRawNodesYaml(raw);
      const manager = await getTestNodeManager();

      await expect(manager.writeNodeToYaml({
        id: 'new', name: 'New', host: 'new.example.com', secret: 'secret',
        kernels: [{ type: 'sing-box' }], location: 'test', enabled: true,
      })).rejects.toThrow('至少选择一个内核');

      const { getStateStore } = await import('../stateStore');
      expect(await getStateStore().get('nodes.yaml')).toBe(raw);
    });

    it('updates only the target node kernels while preserving SSH, Agent, and other nodes', async () => {
      const raw = `nodes:
  - id: target
    name: Target
    host: target.example.com
    secret: secret
    kernels:
      - type: "sing-box"
    location: test
    enabled: true
    ssh:
      user: "root"
      authMethod: "password"
      hostKey: "host-key"
      password: "login-password"
    agent:
      deployed: true
      status: "running"
  - id: untouched
    name: Untouched
    host: untouched.example.com
    secret: other
    kernels:
      - type: "v2ray"
    location: test
    enabled: true
`;
      await writeRawNodesYaml(raw);
      const manager = await getTestNodeManager();

      const updated = await manager.updateNodeKernels('target', [
        { type: 'v2ray' },
        { type: 'sing-box', configPath: '/custom/sing-box.json' },
      ]);

      expect(updated.kernels).toEqual([
        { type: 'sing-box', configPath: '/custom/sing-box.json' },
        { type: 'v2ray' },
      ]);
      const { getStateStore } = await import('../stateStore');
      const yaml = await getStateStore().get('nodes.yaml');
      expect(yaml).toContain('    kernels:\n      - type: "sing-box"\n        configPath: "/custom/sing-box.json"\n      - type: "v2ray"');
      expect(yaml).toContain('      password: "login-password"');
      expect(yaml).toContain('      status: "running"');
      expect(yaml).toContain('  - id: untouched\n    name: Untouched');
      expect(yaml).toContain('    kernels:\n      - type: "v2ray"\n    location: test');
    });

    it('rejects invalid kernel updates without changing nodes.yaml', async () => {
      await writeTestNodesYaml([{
        id: 'target', name: 'Target', host: 'target.example.com', secret: 'secret',
        kernels: [{ type: 'sing-box' }], location: 'test', enabled: true,
      }]);
      const manager = await getTestNodeManager();
      const { getStateStore } = await import('../stateStore');
      const before = await getStateStore().get('nodes.yaml');

      await expect(manager.updateNodeKernels('target', [
        { type: 'xray' }, { type: 'xray' },
      ])).rejects.toThrow('内核类型重复: xray');

      expect(await getStateStore().get('nodes.yaml')).toBe(before);
    });

    it('does not write a dangerous config path during a kernel update', async () => {
      await writeTestNodesYaml([{
        id: 'target', name: 'Target', host: 'target.example.com', secret: 'secret',
        kernels: [{ type: 'sing-box' }], location: 'test', enabled: true,
      }]);
      const manager = await getTestNodeManager();
      const { getStateStore } = await import('../stateStore');
      const before = await getStateStore().get('nodes.yaml');

      await expect(manager.updateNodeKernels('target', [{
        type: 'xray', configPath: '/etc/xray/config.json\nYAML_EOF\ntouch /tmp/pwned',
      }])).rejects.toThrow('内核配置路径无效: xray');

      expect(await getStateStore().get('nodes.yaml')).toBe(before);
    });

    it('updates and returns a disabled node without enabling it', async () => {
      await writeRawNodesYaml(`nodes:
  - id: disabled
    name: Disabled
    host: disabled.example.com
    secret: secret
    kernels:
      - type: "sing-box"
    location: test
    enabled: false
`);
      const manager = await getTestNodeManager();

      const updated = await manager.updateNodeKernels('disabled', [{ type: 'v2ray' }]);

      expect(updated.id).toBe('disabled');
      expect(updated.enabled).toBe(false);
      expect(updated.kernels).toEqual([{ type: 'v2ray' }]);
    });
  });

  describe('SSH credential persistence', () => {
    it('stores an uploaded private key separately from nodes.yaml', async () => {
      const manager = await getTestNodeManager();
      const privateKey = sshUtils.generateKeyPairSync('ed25519').private;
      const saved = await manager.writeNodeWithPrivateKey({
        id: '', name: 'Private key node', host: 'key.example.com', secret: '',
        kernels: [{ type: 'sing-box' }], location: 'test', enabled: true,
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
        kernels: [{ type: 'xray' }], location: 'test', enabled: true,
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
        kernels: [{ type: 'sing-box' as const }], location: 'test', enabled: true,
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

  describe('nodes.yaml watcher', () => {
    it('catches invalid reloads without unhandled rejection and preserves loaded nodes', async () => {
      const manager = await getTestNodeManager();
      await writeTestNodesYaml([{
        id: 'valid', name: 'Valid', host: 'valid.example.com', secret: 'secret',
        kernels: [{ type: 'sing-box' }], location: 'test', enabled: true,
      }]);
      await manager.loadNodes();
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);

      try {
        manager.startWatch();
        await writeRawNodesYaml('nodes:\n  - id: broken\n    kernel: sing-box\n');
        await new Promise(resolve => setTimeout(resolve, 750));

        expect(unhandled).toEqual([]);
        expect(manager.hasRemoteNodes()).toBe(true);
      } finally {
        manager.stopWatch();
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });

  describe('triggerUpdate', () => {
    it('should return results object', async () => {
      const manager = await getTestNodeManager();
      const result = await manager.triggerUpdate();
      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
      expect(typeof result.results).toBe('object');
      expect(result.results.local.message).not.toContain("Cannot access 'config' before initialization");
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
      secret: 'shared-secret-32chars-minimum!!',
      kernels: [{ type: 'sing-box' }, { type: 'xray', configPath: '/custom/xray.json' }],
      location: '新加坡', enabled: true,
    };

    it('should return NodeStatus for a remote node', async () => {
      const manager = await getTestNodeManager();
      // fetchRemoteStatus should exist
      expect(typeof (manager as any).fetchRemoteStatus).toBe('function');
    });

    it('should mark node as offline when fetch fails', async () => {
      const manager = await getTestNodeManager();
      vi.spyOn(manager as any, 'fetchRemoteJson').mockRejectedValue(new Error('unreachable'));
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
      expect(result.configuredKernels).toEqual(remoteNode.kernels);
      expect(result.configuredKernels).not.toBe(remoteNode.kernels);
      expect(result.kernels).toEqual([
        { type: 'sing-box', detected: false, monitored: true, accessible: false, nodesCount: 0, configPaths: [] },
        { type: 'xray', detected: false, monitored: true, accessible: false, nodesCount: 0, configPaths: ['/custom/xray.json'] },
        { type: 'v2ray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
      ]);
    });

    it('should include HMAC headers in remote request', async () => {
      const manager = await getTestNodeManager();
      const headers = manager.signRequest(remoteNode, 'GET', '/api/status');
      expect(headers['X-Node-Id']).toBe('node-sg');
      expect(headers['X-Timestamp']).toBeDefined();
      expect(headers['X-Signature']).toBeDefined();
    });

    it('copies valid Agent kernel statuses and sums their node counts', async () => {
      const secret = 'distributed-secret-32chars-minimum';
      const agent = await startAgentStub(secret);
      const manager = await getTestNodeManager();
      try {
        const status = await (manager as any).fetchRemoteStatus({
          ...remoteNode, host: '0.0.0.0', port: agent.port, secret,
        });
        expect(status.online).toBe(true);
        expect(status.kernels).toHaveLength(3);
        expect(status.nodesCount).toBe(1);
        expect(status.configuredKernels).toEqual([
          { type: 'sing-box' },
          { type: 'xray', configPath: '/custom/xray.json' },
        ]);
        expect(status.kernels.filter((kernel: any) => kernel.monitored).map((kernel: any) => kernel.type))
          .toEqual(['xray']);
      } finally {
        await agent.close();
      }
    });

    it('rejects malformed Agent kernel status arrays', async () => {
      const manager = await getTestNodeManager();
      vi.spyOn(manager as any, 'fetchRemoteJson').mockResolvedValue({ data: { kernels: [{ type: 'xray' }] } });
      const status = await (manager as any).fetchRemoteStatus(remoteNode);
      expect(status.online).toBe(false);
      expect(status.error).toContain('Agent 返回了无效的内核状态');
      expect(status.kernels).toHaveLength(3);
    });

    it('rejects Agent kernel statuses with unknown fields', async () => {
      const manager = await getTestNodeManager();
      vi.spyOn(manager as any, 'fetchRemoteJson').mockResolvedValue({ data: { kernels: [{
        type: 'xray', detected: true, monitored: true, accessible: true,
        nodesCount: 1, configPaths: ['/etc/xray/config.json'], typo: true,
      }] } });
      const status = await (manager as any).fetchRemoteStatus(remoteNode);
      expect(status.online).toBe(false);
      expect(status.error).toContain('Agent 返回了无效的内核状态');
    });
  });

  describe('fetchRemoteUpdate', () => {
    const remoteNode: NodeConfig = {
      id: 'node-jp', name: '东京', host: 'jp.example.com', port: 443,
      secret: 'jp-secret-key-32chars-minimum!', kernels: [{ type: 'sing-box' }],
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
      secret: 'hk-secret-key-32chars-minimum!!', kernels: [{ type: 'v2ray' }],
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
    it('counts globally deduplicated proxy URLs instead of summing per-node counts', async () => {
      const manager = await getTestNodeManager();
      await writeTestNodesYaml([
        {
          id: 'node-a', name: 'Node A', host: 'a.example.com', secret: 'secret-a',
          kernels: [{ type: 'xray' }], location: 'A', enabled: true,
        },
        {
          id: 'node-b', name: 'Node B', host: 'b.example.com', secret: 'secret-b',
          kernels: [{ type: 'xray' }], location: 'B', enabled: true,
        },
      ]);
      const duplicateUrl = 'vless://00000000-0000-4000-8000-000000000001@example.com:443#shared';
      vi.spyOn(manager as any, 'fetchRemoteJson').mockResolvedValue({
        data: {
          sources: [{ kernel: 'xray', url: duplicateUrl }],
          kernels: [
            { type: 'sing-box', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
            { type: 'xray', detected: true, monitored: true, accessible: true, nodesCount: 1, configPaths: ['/etc/xray/config.json'] },
            { type: 'v2ray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
          ],
        },
      });
      vi.spyOn(manager as any, 'fetchRemoteStatus').mockImplementation(async (node: NodeConfig) => ({
        nodeId: node.id,
        name: node.name,
        location: node.location,
        online: true,
        lastSeen: new Date().toISOString(),
        nodesCount: 1,
        configuredKernels: node.kernels,
        kernels: [],
      }));

      const cluster = await manager.getClusterStatus();

      expect(cluster.totalNodes).toBe(2);
      expect(cluster.totalProxies).toBe(1);
    });

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
          kernels: [{ type: 'v2ray' }, { type: 'xray' }],
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
          kernels: [{ type: 'xray' }],
          location: 'loopback',
          enabled: true,
        }]);

        const remoteSources = await manager.collectRemoteNodeSources();
        expect(remoteSources.errors).toEqual([]);
        expect(remoteSources.sources).toEqual([
          {
            kernel: 'xray',
            url: 'vless://00000000-0000-4000-8000-000000000001@example.com:443?type=tcp#remote-a',
            nodeId: 'remote-agent',
            location: 'loopback',
          },
          {
            kernel: 'v2ray',
            url: 'trojan://secret@v2ray.example.com:443#remote-v2ray',
            nodeId: 'remote-agent',
            location: 'loopback',
          },
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

    it('warns with node and kernel identity for monitored inaccessible kernels', async () => {
      const secret = 'distributed-secret-32chars-minimum';
      const data = defaultUrlsData();
      data.sources = data.sources.filter(source => source.kernel !== 'sing-box');
      data.kernels[0] = {
        ...data.kernels[0], monitored: true, accessible: false, error: 'config unreadable',
      };
      const agent = await startAgentStub(secret, data);
      const manager = await getTestNodeManager();
      try {
        await writeTestNodesYaml([{
          id: 'warning-node', name: 'Warning Node', host: '0.0.0.0', port: agent.port, secret,
          kernels: [{ type: 'sing-box' }, { type: 'xray' }, { type: 'v2ray' }],
          location: 'warning-location', enabled: true,
        }]);

        const result = await manager.collectRemoteNodeSources();
        expect(result.sources).toHaveLength(2);
        expect(result.errors.join('\n')).toContain('Warning Node');
        expect(result.errors.join('\n')).toContain('warning-node');
        expect(result.errors.join('\n')).toContain('sing-box');
        expect(result.errors.join('\n')).toContain('config unreadable');
      } finally {
        await agent.close();
      }
    }, 10_000);

    it.each([
      ['missing kernel status', (() => {
        const data = defaultUrlsData();
        data.sources = data.sources.filter(source => source.kernel !== 'v2ray');
        data.kernels = data.kernels.filter(kernel => kernel.type !== 'v2ray');
        return data;
      })()],
      ['nodesCount mismatch', (() => {
        const data = defaultUrlsData();
        data.kernels[1] = { ...data.kernels[1], nodesCount: 2 };
        return data;
      })()],
      ['source without matching accessible status', (() => {
        const data = defaultUrlsData();
        data.kernels[1] = { ...data.kernels[1], monitored: false, accessible: false };
        return data;
      })()],
    ])('rejects contradictory Agent URL payload: %s', async (_case, data) => {
      const secret = 'distributed-secret-32chars-minimum';
      const agent = await startAgentStub(secret, data);
      const manager = await getTestNodeManager();
      try {
        await writeTestNodesYaml([{
          id: 'bad-payload', name: 'Bad Payload', host: '0.0.0.0', port: agent.port, secret,
          kernels: [{ type: 'xray' }], location: 'test', enabled: true,
        }]);

        const result = await manager.collectRemoteNodeSources();
        expect(result.sources).toEqual([]);
        expect(result.errors.join('\n')).toContain('Bad Payload');
        expect(result.errors.join('\n')).toContain('bad-payload');
      } finally {
        await agent.close();
      }
    }, 10_000);

    it('locates a rejected node request by node name and id', async () => {
      const manager = await getTestNodeManager();
      await writeTestNodesYaml([{
        id: 'offline-source', name: 'Offline Source', host: '127.0.0.1', port: 1, secret: '',
        kernels: [{ type: 'xray' }], location: 'test', enabled: true,
      }]);

      const result = await manager.collectRemoteNodeSources();
      expect(result.sources).toEqual([]);
      expect(result.errors.join('\n')).toContain('Offline Source');
      expect(result.errors.join('\n')).toContain('offline-source');
    });
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
