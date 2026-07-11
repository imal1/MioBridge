// TDD RED phase for Task 1: Types definitions
// These tests verify the new types compile and have correct shapes

import { describe, it, expect } from 'vitest';

// Import types to verify they exist and have correct shape
import type {
  NodeConfig,
  NodeStatus,
  ClusterStatus,
  KernelAdapter,
  KernelType,
  NodesYaml,
  NodeSshConfig,
  NodeAgentInfo,
  NodeKernelInfo,
} from '../index';

describe('Task 1: Type Definitions', () => {
  describe('NodeConfig', () => {
    it('should have all required fields', () => {
      const node: NodeConfig = {
        id: 'node-a',
        name: '本地',
        host: 'localhost',
        port: 3001,
        secret: '',
        kernel: 'sing-box',
        location: '东京',
        enabled: true,
      };

      expect(node.id).toBe('node-a');
      expect(node.name).toBe('本地');
      expect(node.host).toBe('localhost');
      expect(node.port).toBe(3001);
      expect(node.secret).toBe('');
      expect(node.kernel).toBe('sing-box');
      expect(node.location).toBe('东京');
      expect(node.enabled).toBe(true);
    });

    it('should accept all kernel types', () => {
      const singBoxNode: NodeConfig = {
        id: 'n1', name: 's', host: 'h', port: 1, secret: '',
        kernel: 'sing-box', location: 'l', enabled: true,
      };
      const xrayNode: NodeConfig = {
        id: 'n2', name: 'x', host: 'h', port: 1, secret: '',
        kernel: 'xray', location: 'l', enabled: true,
      };
      const v2rayNode: NodeConfig = {
        id: 'n3', name: 'v', host: 'h', port: 1, secret: '',
        kernel: 'v2ray', location: 'l', enabled: true,
      };

      expect(singBoxNode.kernel).toBe('sing-box');
      expect(xrayNode.kernel).toBe('xray');
      expect(v2rayNode.kernel).toBe('v2ray');
    });
  });

  describe('NodeStatus', () => {
    it('should have required fields for online node', () => {
      const status: NodeStatus = {
        nodeId: 'node-a',
        name: '本地',
        kernel: 'sing-box',
        location: '东京',
        online: true,
        latency: 5,
        nodesCount: 10,
        subscriptionExists: true,
        clashExists: true,
        mihomoAvailable: true,
        kernelAccessible: true,
        version: '0.2.0',
        uptime: 3600,
      };

      expect(status.nodeId).toBe('node-a');
      expect(status.online).toBe(true);
      expect(status.latency).toBe(5);
      expect(status.nodesCount).toBe(10);
      expect(status.version).toBe('0.2.0');
    });

    it('should allow optional fields for offline node', () => {
      const status: NodeStatus = {
        nodeId: 'offline-node',
        name: '离线节点',
        kernel: 'xray',
        location: '新加坡',
        online: false,
        error: '连接超时',
      };

      expect(status.online).toBe(false);
      expect(status.error).toBe('连接超时');
      expect(status.nodesCount).toBeUndefined();
      expect(status.version).toBeUndefined();
    });
  });

  describe('ClusterStatus', () => {
    it('should aggregate node statuses', () => {
      const nodeStatuses: NodeStatus[] = [
        { nodeId: 'local', name: '本地', kernel: 'sing-box', location: '本地', online: true, nodesCount: 10 },
        { nodeId: 'node-b', name: '新加坡', kernel: 'xray', location: '新加坡', online: true, nodesCount: 5 },
        { nodeId: 'node-c', name: '洛杉矶', kernel: 'v2ray', location: '洛杉矶', online: false, error: '超时' },
      ];

      const cluster: ClusterStatus = {
        totalNodes: 3,
        onlineNodes: 2,
        totalProxies: 15,
        nodes: nodeStatuses,
        lastUpdated: new Date().toISOString(),
      };

      expect(cluster.totalNodes).toBe(3);
      expect(cluster.onlineNodes).toBe(2);
      expect(cluster.totalProxies).toBe(15);
      expect(cluster.nodes).toHaveLength(3);
      expect(cluster.lastUpdated).toBeDefined();
    });
  });

  describe('KernelAdapter interface', () => {
    it('should define the contract for kernel adapters', () => {
      // Type-level verification: create a mock that satisfies KernelAdapter
      const mockAdapter: KernelAdapter = {
        type: 'sing-box',
        getConfigPaths: async () => ['/path/to/config.json'],
        extractNodeUrls: async () => ['vless://...'],
        isAvailable: async () => true,
      };

      expect(mockAdapter.type).toBe('sing-box');
    });
  });

  describe('KernelType', () => {
    it('should be a union of three kernel names', () => {
      const types: KernelType[] = ['sing-box', 'xray', 'v2ray'];
      expect(types).toHaveLength(3);
      expect(types).toContain('sing-box');
      expect(types).toContain('xray');
      expect(types).toContain('v2ray');
    });
  });

  describe('NodesYaml', () => {
    it('should wrap an array of NodeConfig', () => {
      const yaml: NodesYaml = {
        nodes: [
          { id: 'n1', name: 'N1', host: 'h1', port: 443, secret: 'abc', kernel: 'sing-box', location: 'jp', enabled: true },
          { id: 'n2', name: 'N2', host: 'h2', port: 443, secret: 'def', kernel: 'xray', location: 'sg', enabled: false },
        ],
      };

      expect(yaml.nodes).toHaveLength(2);
      expect(yaml.nodes[0].id).toBe('n1');
      expect(yaml.nodes[1].enabled).toBe(false);
    });
  });
});

describe('v1.0 Agent types', () => {
  it('NodeSshConfig should have an explicit auth method and credential reference', () => {
    const ssh: NodeSshConfig = {
      user: 'root',
      port: 22,
      authMethod: 'privateKey',
      credentialRef: 'ssh-keys/node-test',
      hostKey: 'ssh-ed25519 AAA...',
    };
    expect(ssh.user).toBe('root');
    expect(ssh.port).toBe(22);
  });

  it('NodeAgentInfo should have deployed, version, status, lastDeploy', () => {
    const agent: NodeAgentInfo = {
      deployed: true,
      version: '1.0.0',
      status: 'running',
      lastDeploy: '2026-06-27T10:00:00Z',
    };
    expect(agent.status).toBe('running');
  });

  it('NodeKernelInfo should have installed, version, installScript', () => {
    const kernel: NodeKernelInfo = {
      installed: true,
      version: '25.3.6',
      installScript: 'sing-box',
    };
    expect(kernel.installed).toBe(true);
  });

  it('NodeConfig should accept optional ssh, agent, kernelInfo', () => {
    const cfg: NodeConfig = {
      id: 'test', name: 'Test', host: 'example.com', port: 443,
      secret: '', kernel: 'sing-box', location: 'test', enabled: true,
      ssh: { user: 'root', port: 22, authMethod: 'password', hostKey: '', password: 'test-password' },
      agent: { deployed: false, version: '', status: 'not_deployed', lastDeploy: '' },
      kernelInfo: { installed: false, version: '', installScript: '' },
    };
    expect(cfg.ssh?.user).toBe('root');
    expect(cfg.agent?.status).toBe('not_deployed');
  });
});
