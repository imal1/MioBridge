// @vitest-environment jsdom
// Phase C GREEN: Cluster Dashboard integration tests
// Tests verify Dashboard renders cluster view with SSE updates

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

// Mock EventSource for SSE
class MockEventSource {
  url: string;
  onmessage: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onopen: ((e: any) => void) | null = null;
  readyState: number = 0;
  static instances: MockEventSource[] = [];

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.readyState = 2;
  }
}

// Mock apiService for action callbacks
const mockTriggerClusterUpdate = vi.fn().mockResolvedValue({ success: true, data: {} });
const mockClusterHealthCheck = vi.fn().mockResolvedValue({ success: true, data: {} });

vi.mock('@/lib/api', () => ({
  apiService: {
    getStatus: vi.fn().mockResolvedValue({}),
    getClusterStatus: vi.fn().mockResolvedValue({ success: true, data: null }),
    updateSubscription: vi.fn().mockResolvedValue({ success: true, nodesCount: 0, message: 'ok' }),
    getDownloadUrl: (filename: string) => `/${filename}`,
    triggerClusterUpdate: (...args: any[]) => mockTriggerClusterUpdate(...args),
    clusterHealthCheck: (...args: any[]) => mockClusterHealthCheck(...args),
  },
}));

// Mock SSE hook to return controlled data
vi.mock('@/lib/useClusterSSE', () => ({
  useClusterSSE: (initial: any) => initial,
}));

const mockStatusData = {
  rawExists: true,
  subscriptionExists: true,
  clashExists: true,
  mihomoAvailable: true,
  nodesCount: 12,
  uptime: 120,
  version: '0.2.0',
  mihomoVersion: '1.19.0',
};

const mockClusterData = {
  totalNodes: 2,
  onlineNodes: 1,
  totalProxies: 12,
  nodes: [
    {
      nodeId: 'node-sg', name: '新加坡', location: '新加坡',
      configuredKernels: [{ type: 'sing-box' as const }, { type: 'xray' as const }],
      kernels: [
        { type: 'sing-box' as const, detected: true, monitored: true, accessible: true, nodesCount: 8, version: '1.11.0', configPaths: ['/etc/sing-box/config.json'] },
      ],
      online: true, latency: 45, nodesCount: 12,
      subscriptionExists: true, clashExists: true,
      mihomoAvailable: true,
      version: '0.2.0', uptime: 3600,
      agent: { deployed: true, version: '0.2.0', status: 'running' as const, lastDeploy: '' },
    },
    {
      nodeId: 'node-jp', name: '东京', location: '东京',
      configuredKernels: [{ type: 'xray' as const }, { type: 'v2ray' as const }],
      kernels: [],
      online: false, error: '连接超时',
      agent: { deployed: true, version: '0.2.0', status: 'running' as const, lastDeploy: '' },
    },
  ],
  lastUpdated: new Date().toISOString(),
};

describe('Phase C: Cluster Dashboard Page', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    (globalThis as any).EventSource = MockEventSource;
    mockTriggerClusterUpdate.mockClear();
    mockClusterHealthCheck.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render current overview with child cluster counts', async () => {
    const Dashboard = (await import('@/components/Dashboard')).default;
    render(<Dashboard initialCluster={mockClusterData} initialStatus={mockStatusData} initialError={null} />);
    expect(screen.getByRole('heading', { name: '总览' })).toBeDefined();
    expect(screen.getByText('订阅节点')).toBeDefined();
    expect(screen.getByText('12')).toBeDefined();
    expect(screen.getByText('子节点在线')).toBeDefined();
    expect(screen.getByText('1/2')).toBeDefined();
  });

  it('counts ready kernels against desired configured kernels', async () => {
    const Dashboard = (await import('@/components/Dashboard')).default;
    render(<Dashboard initialCluster={mockClusterData} initialStatus={mockStatusData} initialError={null} />);
    expect(screen.getByText('子节点内核')).toBeDefined();
    expect(screen.getByText('1/4 可用')).toBeDefined();
  });

  it('shows healthy/configured capability counts per kernel type', async () => {
    const ConfigPage = (await import('@/pages/config')).default;
    render(<ConfigPage
      initialCluster={mockClusterData}
      initialStatus={mockStatusData}
      initialConfigs={['default']}
      frontendConfig={{}}
      initialError={null}
    />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: '运行能力' }), { button: 0, ctrlKey: false });
    expect(screen.getByText('1/1 可用')).toBeDefined();
    expect(screen.getByText('0/2 可用')).toBeDefined();
    expect(screen.getByText('0/1 可用')).toBeDefined();
  });

  it('should show no-node remote Agent state as actionable', async () => {
    const Dashboard = (await import('@/components/Dashboard')).default;
    render(<Dashboard initialCluster={{ totalNodes: 0, onlineNodes: 0, totalProxies: 0, nodes: [], lastUpdated: new Date().toISOString() }} initialStatus={mockStatusData} initialError={null} />);
    expect(screen.getByText('远端 Agent')).toBeDefined();
    expect(screen.getByText('尚未添加子节点')).toBeDefined();
    expect(screen.getAllByText('处理').length).toBeGreaterThan(0);
  });

  it('should display error alert when initialError is set', async () => {
    const Dashboard = (await import('@/components/Dashboard')).default;
    render(<Dashboard initialCluster={null} initialError="网络错误" />);
    expect(screen.getByText('网络错误')).toBeDefined();
  });

  it('should render workflow shortcuts when no cluster data is available', async () => {
    const Dashboard = (await import('@/components/Dashboard')).default;
    render(<Dashboard initialCluster={null} initialError={null} />);
    expect(screen.getByRole('link', { name: /添加节点/ })).toBeDefined();
    expect(screen.getByRole('link', { name: /部署 Agent/ })).toBeDefined();
  });

  it('should render update and artifact actions', async () => {
    const Dashboard = (await import('@/components/Dashboard')).default;
    render(<Dashboard initialCluster={mockClusterData} initialStatus={mockStatusData} initialError={null} />);
    expect(screen.getByRole('button', { name: '立即更新订阅' })).toBeDefined();
    expect(screen.getByRole('link', { name: '输出产物中心' })).toBeDefined();
    expect(screen.getAllByRole('link', { name: '下载' }).length).toBeGreaterThan(0);
  });
});
