// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { ClusterOverview } from '../ClusterOverview';
import { NodeCard } from '../NodeCard';
import { NodeDetail } from '../NodeDetail';
import { getKernelDisplayStatus } from '../KernelStatus';
import type { KernelRuntimeStatus, NodeStatus, ClusterStatus } from '@/lib/types';

const runtimeKernels = (
  overrides: Partial<Record<KernelRuntimeStatus['type'], Partial<KernelRuntimeStatus>>> = {},
): KernelRuntimeStatus[] => ([
  {
    type: 'sing-box', detected: true, monitored: true, accessible: true,
    nodesCount: 8, version: '1.11.0', configPaths: ['/etc/sing-box/config.json'],
    ...overrides['sing-box'],
  },
  {
    type: 'xray', detected: false, monitored: true, accessible: false,
    nodesCount: 0, configPaths: ['/etc/xray/config.json'], error: 'xray binary missing',
    ...overrides.xray,
  },
  {
    type: 'v2ray', detected: true, monitored: false, accessible: false,
    nodesCount: 0, version: '5.28.0', configPaths: ['/etc/v2ray/config.json'],
    ...overrides.v2ray,
  },
]);

const mockNode: NodeStatus = {
  nodeId: 'node-sg',
  name: '新加坡',
  configuredKernels: [{ type: 'sing-box' }, { type: 'xray' }],
  kernels: runtimeKernels(),
  location: '新加坡',
  online: true,
  latency: 45,
  nodesCount: 8,
  version: '1.0.0',
  uptime: 3600,
};

const mockOfflineNode: NodeStatus = {
  nodeId: 'node-jp',
  name: '东京',
  configuredKernels: [{ type: 'sing-box' }],
  kernels: [],
  location: '东京',
  online: false,
  error: '连接超时',
};

const localNode: NodeStatus = {
  nodeId: 'local',
  name: '本地',
  configuredKernels: [{ type: 'sing-box' }, { type: 'v2ray' }],
  kernels: runtimeKernels({
    'sing-box': { nodesCount: 23 },
    xray: { monitored: false, error: undefined },
    v2ray: { monitored: true, accessible: false, error: '配置文件不可读' },
  }),
  location: '本地',
  online: true,
  nodesCount: 23,
  subscriptionExists: true,
  clashExists: true,
  mihomoAvailable: true,
  version: '1.0.0',
  uptime: 7200,
};

const mockCluster: ClusterStatus = {
  totalNodes: 3,
  onlineNodes: 2,
  totalProxies: 35,
  nodes: [mockNode, mockOfflineNode, localNode],
  lastUpdated: new Date().toISOString(),
};

describe('ClusterOverview', () => {
  it('renders online nodes, monitored kernels, healthy kernels, and proxies', () => {
    render(<ClusterOverview cluster={mockCluster} />);
    expect(screen.getByText('在线节点')).toBeDefined();
    expect(screen.getByText('监听内核')).toBeDefined();
    expect(screen.getByText('健康内核')).toBeDefined();
    expect(screen.getByText('代理总数')).toBeDefined();
    expect(screen.getByText('2/3 在线')).toBeDefined();
    expect(screen.getByText('4')).toBeDefined();
    expect(screen.getAllByText('2')).toHaveLength(2);
    expect(screen.getByText('35')).toBeDefined();
  });

  it('uses an explicit empty state when no kernels are monitored', () => {
    render(<ClusterOverview cluster={{
      totalNodes: 1,
      onlineNodes: 0,
      totalProxies: 0,
      nodes: [{ ...mockOfflineNode, configuredKernels: [], kernels: [] }],
      lastUpdated: new Date().toISOString(),
    }} />);
    expect(screen.getByText('无监听内核')).toBeDefined();
    expect(screen.queryByText('0/0 正常')).toBeNull();
  });
});

describe('NodeCard', () => {
  it('renders all kernel labels with their prioritized status', () => {
    render(<NodeCard node={mockNode} />);
    expect(screen.getByText('Sing-Box')).toBeDefined();
    expect(screen.getByText('Xray')).toBeDefined();
    expect(screen.getByText('V2Ray')).toBeDefined();
    expect(screen.getByText('正常')).toBeDefined();
    expect(screen.getByText('安装失败')).toBeDefined();
    expect(screen.getByText('未监听')).toBeDefined();
  });

  it('renders an inaccessible configuration after higher-priority states are excluded', () => {
    const inaccessibleNode = {
      ...mockNode,
      kernels: runtimeKernels({
        xray: { detected: true, monitored: true, accessible: false, error: '配置文件不可读' },
      }),
    };
    render(<NodeCard node={inaccessibleNode} />);
    expect(screen.getByText('配置不可访问')).toBeDefined();
  });

  it('renders three unknown pills for an offline DTO with an empty runtime array', () => {
    render(<NodeCard node={mockOfflineNode} />);
    expect(screen.getAllByText('未知')).toHaveLength(3);
    expect(screen.getAllByTestId('kernel-status-type').map(element => element.textContent))
      .toEqual(['Sing-Box', 'Xray', 'V2Ray']);
    expect(screen.getByText(/连接超时/)).toBeDefined();
  });

  it('normalizes missing and out-of-order online runtime entries', () => {
    const partialNode = {
      ...mockNode,
      kernels: [mockNode.kernels[2], mockNode.kernels[0]],
    };
    render(<NodeCard node={partialNode} />);
    expect(screen.getAllByTestId('kernel-status-type').map(element => element.textContent))
      .toEqual(['Sing-Box', 'Xray', 'V2Ray']);
    expect(screen.getByText('未知')).toBeDefined();
  });

  it('expands to show detail on click', () => {
    render(<NodeCard node={mockNode} />);
    fireEvent.click(screen.getByRole('heading', { name: '新加坡' }));
    expect(screen.getByRole('dialog', { name: '新加坡' })).toBeDefined();
  });
});

describe('NodeDetail', () => {
  const onClose = vi.fn();

  it('shows type, version, config paths, proxy count, and error for each kernel', () => {
    render(<NodeDetail node={mockNode} isOpen onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: '新加坡' });
    expect(within(dialog).getByText('Sing-Box')).toBeDefined();
    expect(within(dialog).getByText('1.11.0')).toBeDefined();
    expect(within(dialog).getByText('/etc/sing-box/config.json')).toBeDefined();
    expect(within(dialog).getByText('8 个代理')).toBeDefined();
    expect(within(dialog).getByText('xray binary missing')).toBeDefined();
    expect(within(dialog).getByText('5.28.0')).toBeDefined();
  });

  it('renders kernel details as unknown while a node is offline', () => {
    render(<NodeDetail node={mockOfflineNode} isOpen onClose={onClose} />);
    expect(screen.getAllByText('未知')).toHaveLength(3);
    expect(screen.getByRole('region', { name: 'Sing-Box 内核详情' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Xray 内核详情' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'V2Ray 内核详情' })).toBeDefined();
  });
});

describe('kernel status priority boundaries', () => {
  it('lets unmonitored override an installation error', () => {
    expect(getKernelDisplayStatus(true, {
      type: 'xray', detected: false, monitored: false, accessible: false,
      nodesCount: 0, configPaths: [], error: 'binary missing',
    })).toBe('unmonitored');
  });

  it('treats detected false with accessible true and no error as normal', () => {
    expect(getKernelDisplayStatus(true, {
      type: 'xray', detected: false, monitored: true, accessible: true,
      nodesCount: 0, configPaths: [],
    })).toBe('normal');
  });
});
