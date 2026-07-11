// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  detectKernels: vi.fn(),
  updateNodeKernels: vi.fn(),
  deployNode: vi.fn(),
  getClusterStatus: vi.fn(),
  clusterHealthCheck: vi.fn(),
  restartAgent: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ apiService: api }));

const node = {
  nodeId: 'node-edit', name: '东京节点', location: 'JP', online: true, nodesCount: 4,
  configuredKernels: [{ type: 'xray' as const, configPath: '/custom/xray.json' }],
  kernels: [
    { type: 'sing-box' as const, detected: true, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
    { type: 'xray' as const, detected: true, monitored: true, accessible: true, nodesCount: 4, configPaths: ['/custom/xray.json'] },
    { type: 'v2ray' as const, detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
  ],
  agent: { deployed: true, version: '1.0.0', status: 'running' as const, lastDeploy: '' },
};

const cluster = { totalNodes: 1, onlineNodes: 1, totalProxies: 4, nodes: [node], lastUpdated: new Date().toISOString() };
const updatedNode = {
  ...node,
  configuredKernels: [
    { type: 'sing-box' as const, configPath: '/etc/sing-box/config.json' },
    { type: 'xray' as const, configPath: '/custom/xray.json' },
  ],
  kernels: node.kernels,
};
const updatedCluster = { ...cluster, nodes: [updatedNode], lastUpdated: new Date(Date.now() + 1000).toISOString() };
const detections = [
  { type: 'v2ray' as const, installed: false, defaultConfigPath: '/usr/local/etc/v2ray/config.json' },
  { type: 'xray' as const, installed: true, version: '1.8.0', defaultConfigPath: '/usr/local/etc/xray/config.json' },
  { type: 'sing-box' as const, installed: true, version: '1.11.0', defaultConfigPath: '/etc/sing-box/config.json' },
];

describe('Nodes page kernel editing', () => {
  beforeEach(() => {
    api.detectKernels.mockReset();
    api.updateNodeKernels.mockReset();
    api.deployNode.mockReset();
    api.getClusterStatus.mockReset();
    api.clusterHealthCheck.mockReset();
    api.restartAgent.mockReset();
    api.detectKernels.mockResolvedValue(detections);
    api.updateNodeKernels.mockResolvedValue({ success: true, data: { id: 'node-edit' }, timestamp: '' });
    api.deployNode.mockResolvedValue({ success: true, timestamp: '' });
    api.getClusterStatus.mockResolvedValue({ success: true, data: cluster, timestamp: '' });
  });

  it('detects a saved node, preselects monitored types, then deploys the selection atomically', async () => {
    const { default: NodesPage } = await import('@/pages/nodes');
    render(<NodesPage initialCluster={cluster} initialError={null} />);

    fireEvent.click(screen.getByRole('button', { name: '调整内核' }));
    await screen.findByText('选择监听内核');
    expect(api.detectKernels).toHaveBeenCalledWith({ nodeId: 'node-edit' });
    expect((screen.getByRole('checkbox', { name: /Xray/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: /Sing-Box/ }) as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole('checkbox', { name: /Sing-Box/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认并部署' }));
    await waitFor(() => expect(api.deployNode).toHaveBeenCalledWith('node-edit', [
      { type: 'sing-box', configPath: '/etc/sing-box/config.json' },
      { type: 'xray', configPath: '/usr/local/etc/xray/config.json' },
    ]));
    expect(api.updateNodeKernels).not.toHaveBeenCalled();
    expect(api.getClusterStatus).toHaveBeenCalled();
  });

  it('keeps selection editable and retries deploy without changing saved kernels when start fails', async () => {
    api.deployNode
      .mockResolvedValueOnce({ success: false, error: 'queue unavailable', timestamp: '' })
      .mockResolvedValueOnce({ success: true, timestamp: '' });
    api.getClusterStatus.mockResolvedValue({ success: true, data: updatedCluster, timestamp: '' });
    const { default: NodesPage } = await import('@/pages/nodes');
    render(<NodesPage initialCluster={cluster} initialError={null} />);
    fireEvent.click(screen.getByRole('button', { name: '调整内核' }));
    await screen.findByText('选择监听内核');
    fireEvent.click(screen.getByRole('checkbox', { name: /Sing-Box/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认并部署' }));
    expect(await screen.findByText('queue unavailable')).toBeDefined();
    expect((screen.getByRole('checkbox', { name: /Sing-Box/ }) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole('checkbox', { name: /Xray/ }) as HTMLInputElement).disabled).toBe(false);
    expect(api.getClusterStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '重试部署' }));
    await waitFor(() => expect(api.deployNode).toHaveBeenCalledTimes(2));
    expect(api.updateNodeKernels).not.toHaveBeenCalled();
  });

  it('refreshes the updated snapshot on partial failure so cancel and reopen use new preselection', async () => {
    api.deployNode.mockResolvedValue({ success: false, error: 'queue unavailable', timestamp: '' });
    api.getClusterStatus.mockResolvedValue({ success: true, data: updatedCluster, timestamp: '' });
    const { default: NodesPage } = await import('@/pages/nodes');
    render(<NodesPage initialCluster={cluster} initialError={null} />);
    fireEvent.click(screen.getByRole('button', { name: '调整内核' }));
    await screen.findByText('选择监听内核');
    fireEvent.click(screen.getByRole('checkbox', { name: /Sing-Box/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认并部署' }));
    await screen.findByText('queue unavailable');
    expect(api.getClusterStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '调整内核' }));
    await screen.findByText('选择监听内核');
    expect((screen.getByRole('checkbox', { name: /Sing-Box/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('uses desired kernels in an offline summary and marks runtime status unknown', async () => {
    const offlineNode = {
      ...node,
      nodeId: 'node-offline',
      online: false,
      error: '连接失败',
      configuredKernels: [{ type: 'xray' as const }, { type: 'v2ray' as const }],
      kernels: [],
    };
    const { default: NodesPage } = await import('@/pages/nodes');
    render(<NodesPage
      initialCluster={{ ...cluster, onlineNodes: 0, nodes: [offlineNode] }}
      initialError={null}
    />);
    expect(screen.getByText('Xray · V2Ray · 状态未知 · node-offline')).toBeDefined();
    expect(screen.getAllByText('未知')).toHaveLength(3);
  });
});
