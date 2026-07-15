// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getClusterStatus: vi.fn(),
  getDeployStatus: vi.fn(),
  getDeploymentPlans: vi.fn(),
  getStatus: vi.fn(),
  deployNode: vi.fn(),
  deployBatch: vi.fn(),
  updateSubscription: vi.fn(),
  updateNodeKernels: vi.fn(),
  updateNodeConnection: vi.fn(),
  detectKernels: vi.fn(),
  addNode: vi.fn(),
  getDeployEventsUrl: vi.fn(() => '/api/cluster/deploy/events'),
}));

vi.mock('@/lib/api', () => ({ apiService: api }));

const localNode = {
  nodeId: 'local',
  name: '本机节点',
  kind: 'local' as const,
  configuredKernels: [{ type: 'sing-box' as const }],
  kernels: [],
  location: '本机',
  online: true,
};

const localPlan = {
  nodeId: 'local', nodeName: '本机节点', kind: 'local' as const,
  preflightReady: true, deployable: true, ready: false, recommendedScope: 'kernels' as const, blockers: [],
  checks: [
    { id: 'prerequisite:local', category: 'prerequisite' as const, label: '本机执行环境', status: 'ready' as const, message: '由当前服务直接部署' },
    { id: 'listener', category: 'listener' as const, label: '本机监听程序', status: 'ready' as const, message: '已部署并成功监听' },
    { id: 'kernel:sing-box', category: 'kernel' as const, label: 'sing-box', kernelType: 'sing-box' as const, status: 'action_required' as const, message: '尚未安装' },
  ],
};

describe('local node deployment page', () => {
  beforeEach(() => {
    api.getClusterStatus.mockReset().mockResolvedValue({
      success: true,
      data: { totalNodes: 1, onlineNodes: 1, totalProxies: 0, nodes: [localNode], lastUpdated: new Date().toISOString() },
      timestamp: '',
    });
    api.getDeployStatus.mockReset().mockResolvedValue({
      success: true,
      data: { deployments: { local: {
        nodeId: 'local', deploymentId: 'runtime-local', scope: 'all', step: 'verify', status: 'error',
        message: '内核未就绪：sing-box 未部署：本机 sing-box 不可用', progress: 50, startedAt: 0,
      } } },
      timestamp: '',
    });
    api.getDeploymentPlans.mockReset().mockResolvedValue({ success: true, data: { plans: { local: localPlan } }, timestamp: '' });
    api.getStatus.mockReset().mockResolvedValue({
      subscriptionExists: false, clashExists: false, rawExists: false, mihomoAvailable: true, uptime: 1, version: '1.0.8',
    });
    api.deployNode.mockReset().mockResolvedValue({ success: true, data: { deploymentId: 'local-deploy' }, timestamp: '' });
    api.deployBatch.mockReset().mockResolvedValue({ success: true, data: { started: 0, skipped: 0, failed: 0, results: [] }, timestamp: '' });
    api.updateSubscription.mockReset().mockResolvedValue({ success: true, message: 'ok', timestamp: '', nodesCount: 1, clashGenerated: true, backupCreated: '' });
    api.updateNodeKernels.mockReset().mockResolvedValue({ success: true, data: {}, timestamp: '' });
    api.updateNodeConnection.mockReset().mockResolvedValue({ success: true, data: {}, timestamp: '' });
    api.detectKernels.mockReset();
    api.addNode.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows the registered local node and allows redeployment', async () => {
    const { default: DeployPage } = await import('@/pages/deploy');
    render(<DeployPage />);

    expect((await screen.findAllByText('本机节点')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('失败').length).toBeGreaterThan(0);
    expect(screen.getAllByText('内核未就绪：sing-box 未部署：本机 sing-box 不可用').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: '一键部署' })[0]!);
    await waitFor(() => expect(api.deployNode).toHaveBeenCalledWith('local', 'kernels'));
  });

  it('closes the no-kernels gap by saving inline configuration and starting deployment', async () => {
    api.getClusterStatus.mockResolvedValue({
      success: true,
      data: { totalNodes: 1, onlineNodes: 1, totalProxies: 0, nodes: [{ ...localNode, configuredKernels: [] }], lastUpdated: new Date().toISOString() },
      timestamp: '',
    });
    api.getDeployStatus.mockResolvedValue({
      success: true,
      data: { deployments: { local: {
        nodeId: 'local', deploymentId: 'runtime-local', scope: 'all', step: 'verify', status: 'no_kernels',
        message: '暂无内核', progress: 0, startedAt: 0,
      } } },
      timestamp: '',
    });
    api.getDeploymentPlans.mockResolvedValue({
      success: true,
      data: { plans: { local: {
        ...localPlan,
        preflightReady: false, deployable: false, recommendedScope: null,
        blockers: ['未配置内核，请先选择至少一个内核'],
        checks: localPlan.checks.filter(check => check.category !== 'kernel').concat({
          id: 'kernel:none', category: 'kernel', label: '内核配置', status: 'blocked', message: '未配置内核，请先选择至少一个内核',
        } as typeof localPlan.checks[number]),
      } } },
      timestamp: '',
    });
    const { default: DeployPage } = await import('@/pages/deploy');
    render(<DeployPage />);
    expect((await screen.findAllByText('未配置内核，请先选择至少一个内核')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '配置内核并部署' }));
    expect(await screen.findByRole('dialog', { name: '选择监听内核' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sing-Box 安装并监听' }));
    fireEvent.click(screen.getByRole('button', { name: '保存配置并一键部署' }));
    await waitFor(() => expect(api.updateNodeKernels).toHaveBeenCalledWith('local', [
      { type: 'sing-box', configPath: '/etc/sing-box/config.json' },
    ]));
    await waitFor(() => expect(api.deployNode).toHaveBeenCalledWith('local', 'all'));
  });

  it('batch deploys every actionable node from the workflow header', async () => {
    api.deployBatch.mockResolvedValue({
      success: true,
      data: { started: 1, skipped: 0, failed: 0, results: [
        { nodeId: 'local', status: 'started', scope: 'kernels', deploymentId: 'batch-1', message: '部署已启动' },
      ] },
      timestamp: '',
    });
    const { default: DeployPage } = await import('@/pages/deploy');
    render(<DeployPage />);
    fireEvent.click(await screen.findByRole('button', { name: '部署全部待处理（1）' }));
    await waitFor(() => expect(api.deployBatch).toHaveBeenCalledTimes(1));
    expect((screen.getByRole('button', { name: '部署中' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('generates subscription artifacts only after every node is ready', async () => {
    api.getDeployStatus.mockResolvedValue({
      success: true,
      data: { deployments: { local: {
        nodeId: 'local', deploymentId: 'runtime-local', scope: 'all', step: 'verify', status: 'success',
        message: '监听程序正常，1 个已配置内核全部就绪', progress: 100, startedAt: 0,
      } } },
      timestamp: '',
    });
    api.getDeploymentPlans.mockResolvedValue({
      success: true,
      data: { plans: { local: {
        ...localPlan,
        ready: true,
        recommendedScope: null,
        checks: localPlan.checks.map(check => ({ ...check, status: 'ready', message: '已就绪' })),
      } } },
      timestamp: '',
    });
    const { default: DeployPage } = await import('@/pages/deploy');
    render(<DeployPage />);
    fireEvent.click(await screen.findByRole('button', { name: '生成并验收订阅' }));
    await waitFor(() => expect(api.updateSubscription).toHaveBeenCalledTimes(1));
  });

  it('applies live deployment events without waiting for the fallback poll', async () => {
    class FakeEventSource {
      static latest: FakeEventSource | undefined;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readonly listeners = new Map<string, Set<EventListener>>();

      constructor(readonly url: string) { FakeEventSource.latest = this; }
      addEventListener(type: string, listener: EventListener) {
        const listeners = this.listeners.get(type) ?? new Set<EventListener>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }
      removeEventListener(type: string, listener: EventListener) { this.listeners.get(type)?.delete(listener); }
      close() {}
      emit(type: string, data: unknown) {
        const event = new MessageEvent(type, { data: JSON.stringify(data) });
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const { default: DeployPage } = await import('@/pages/deploy');
    render(<DeployPage />);
    await screen.findAllByText('本机节点');

    act(() => {
      FakeEventSource.latest?.onopen?.();
      FakeEventSource.latest?.emit('progress', {
        nodeId: 'local', deploymentId: 'live-1', scope: 'all', step: 'verify', status: 'running',
        message: '正在实时核验本机内核', progress: 42, startedAt: 1,
      });
    });

    expect(screen.getByText('实时进度已连接')).toBeTruthy();
    expect(screen.getAllByText('正在实时核验本机内核').length).toBeGreaterThan(0);
    expect(screen.getAllByText('42%').length).toBeGreaterThan(0);
  });

  it('offers separate listener, kernel, and full deployment actions for remote nodes', async () => {
    const remoteNode = {
      ...localNode,
      nodeId: 'edge-1',
      name: '边缘节点',
      kind: 'child' as const,
      location: '远程',
      agent: { deployed: true, version: '1.0.6', status: 'running' as const, lastDeploy: '', port: 3001 },
    };
    api.getClusterStatus.mockResolvedValue({
      success: true,
      data: { totalNodes: 1, onlineNodes: 1, totalProxies: 0, nodes: [remoteNode], lastUpdated: new Date().toISOString() },
      timestamp: '',
    });
    api.getDeployStatus.mockResolvedValue({
      success: true,
      data: { deployments: { 'edge-1': {
        nodeId: 'edge-1', deploymentId: 'runtime-edge-1', scope: 'all', step: 'verify', status: 'success',
        message: '监听程序正常，1 个已配置内核全部就绪', progress: 100, startedAt: 0,
      } } },
      timestamp: '',
    });
    api.getDeploymentPlans.mockResolvedValue({
      success: true,
      data: { plans: { 'edge-1': { ...localPlan, nodeId: 'edge-1', nodeName: '边缘节点', kind: 'child', ready: true, recommendedScope: null } } },
      timestamp: '',
    });
    const { default: DeployPage } = await import('@/pages/deploy');
    render(<DeployPage />);
    await screen.findAllByText('边缘节点');

    expect(screen.getByRole('button', { name: '仅监听程序' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '仅内核' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '全部' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '仅监听程序' }));
    await waitFor(() => expect(api.deployNode).toHaveBeenCalledWith('edge-1', 'listener'));
  });

  it('repairs missing SSH credentials and continues one-click deployment', async () => {
    const remoteNode = {
      ...localNode,
      nodeId: 'edge-2',
      name: '待修复节点',
      kind: 'child' as const,
      location: '远程',
      agent: { deployed: false, version: '', status: 'not_deployed' as const, lastDeploy: '', port: 3001 },
    };
    api.getClusterStatus.mockResolvedValue({
      success: true,
      data: { totalNodes: 1, onlineNodes: 0, totalProxies: 0, nodes: [remoteNode], lastUpdated: new Date().toISOString() },
      timestamp: '',
    });
    api.getDeployStatus.mockResolvedValue({
      success: true,
      data: { deployments: { 'edge-2': {
        nodeId: 'edge-2', deploymentId: 'runtime-edge-2', scope: 'all', step: 'verify', status: 'error',
        message: '监听程序未部署', progress: 10, startedAt: 0,
      } } },
      timestamp: '',
    });
    api.getDeploymentPlans.mockResolvedValue({
      success: true,
      data: { plans: { 'edge-2': {
        ...localPlan,
        nodeId: 'edge-2', nodeName: '待修复节点', kind: 'child', preflightReady: false, deployable: false,
        ready: false, recommendedScope: null, blockers: ['SSH 凭据已丢失，需要重新配置节点'],
        target: { host: '10.0.0.2', user: 'root', port: 22 },
        checks: [
          { id: 'prerequisite:ssh', category: 'prerequisite', label: 'SSH 凭据', status: 'blocked', message: 'SSH 凭据已丢失，需要重新配置节点' },
          ...localPlan.checks.filter(check => check.category !== 'prerequisite'),
        ],
      } } },
      timestamp: '',
    });
    const { default: DeployPage } = await import('@/pages/deploy');
    render(<DeployPage />);
    fireEvent.click(await screen.findByRole('button', { name: '修复连接并部署' }));
    fireEvent.change(screen.getByLabelText('SSH 密码'), { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并继续部署' }));

    await waitFor(() => expect(api.updateNodeConnection).toHaveBeenCalledWith('edge-2', {
      host: '10.0.0.2', user: 'root', port: 22, authMethod: 'password', password: 'new-secret',
    }));
    await waitFor(() => expect(api.deployNode).toHaveBeenCalledWith('edge-2', 'all'));
  });
});
