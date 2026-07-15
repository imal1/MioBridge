import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { NodeStatus } from '@miobridge/core';
import { createNodeCore } from '../../src/composition.js';
import { agentRelease, assessNodeDeployment, planNodeDeployment, SshDeploymentService } from '../../src/dashboard/server/sshDeployment.js';

function runtimeNode(overrides: Partial<NodeStatus> = {}): NodeStatus {
  return {
    nodeId: 'local', name: '本机节点', kind: 'local', location: '本机', online: true,
    listener: { deployed: true, listening: true },
    configuredKernels: [{ type: 'sing-box' }],
    kernels: [{ type: 'sing-box', detected: true, monitored: true, accessible: true, nodesCount: 0, configPaths: [] }],
    ...overrides,
  };
}

describe('Agent release distribution', () => {
  it('maps remote architectures to versioned release artifacts', () => {
    expect(agentRelease('1.0.0', 'x64', {})).toEqual({
      artifact: 'miobridge-agent-1.0.0-linux-x64.gz',
      baseUrl: 'https://github.com/imal1/MioBridge/releases/download/v1.0.0',
    });
    expect(agentRelease('1.0.0', 'arm64', {})).toEqual({
      artifact: 'miobridge-agent-1.0.0-linux-arm64.gz',
      baseUrl: 'https://github.com/imal1/MioBridge/releases/download/v1.0.0',
    });
  });

  it('uses the configured repository or release mirror', () => {
    expect(agentRelease('1.2.3', 'x64', { MIOBRIDGE_REPOSITORY: 'owner/repo' }).baseUrl)
      .toBe('https://github.com/owner/repo/releases/download/v1.2.3');
    expect(agentRelease('1.2.3', 'x64', { MIOBRIDGE_RELEASE_BASE_URL: 'https://mirror.example/v1.2.3' }).baseUrl)
      .toBe('https://mirror.example/v1.2.3');
  });

  it('rechecks the registered local node without pretending configuration is deployment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miobridge-local-deploy-'));
    try {
      const composition = createNodeCore({
        homeDir: root,
        env: { ...process.env, MIOBRIDGE_CONFIG_DIR: join(root, 'runtime') },
      });
      await composition.repository.configureLocalNode(true);
      const before = (await composition.repository.list()).find(node => node.id === 'local')?.kernels;
      const ensured: string[] = [];
      const deployment = new SshDeploymentService(composition, {
        async ensure(type) {
          ensured.push(type);
          return { type, path: `/managed/${type}`, version: 'test', installed: true };
        },
      });
      const result = await deployment.startDeployment('local');
      await vi.waitFor(() => expect(deployment.getProgress('local')?.status).not.toBe('running'));
      expect(deployment.getProgress('local')).toMatchObject({
        deploymentId: result.deploymentId,
        scope: 'all',
        status: 'error',
        message: expect.stringContaining('sing-box'),
      });
      const local = (await composition.repository.list()).find(node => node.id === 'local');
      expect(ensured).toEqual(['sing-box']);
      expect(local?.kernels).toEqual(before);
      expect(local?.agent).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('one-click deploys configured local kernels before final runtime verification', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miobridge-local-one-click-'));
    let available = false;
    try {
      const composition = createNodeCore({
        homeDir: root,
        env: { ...process.env, MIOBRIDGE_CONFIG_DIR: join(root, 'runtime') },
        local: {
          isAvailable: async () => available,
          extractNodeUrls: async () => [],
          getConfigPaths: async () => [],
          getVersion: async () => available ? '1.13.14' : undefined,
        },
      });
      await composition.repository.configureLocalNode(true);
      const deployment = new SshDeploymentService(composition, {
        async ensure(type) {
          available = true;
          return { type, path: `/managed/${type}`, version: '1.13.14', installed: true };
        },
      });

      await deployment.startDeployment('local');
      await vi.waitFor(() => expect(deployment.getProgress('local')?.status).toBe('success'));
      expect(deployment.getProgress('local')).toMatchObject({
        scope: 'all', status: 'success', progress: 100,
        message: '监听程序正常，1 个已配置内核全部就绪',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a second deployment while the same node still has an active task', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miobridge-local-single-flight-'));
    let available = false;
    let releaseEnsure!: () => void;
    const ensureGate = new Promise<void>(resolve => { releaseEnsure = resolve; });
    try {
      const composition = createNodeCore({
        homeDir: root,
        env: { ...process.env, MIOBRIDGE_CONFIG_DIR: join(root, 'runtime') },
        local: {
          isAvailable: async () => available,
          extractNodeUrls: async () => [],
          getConfigPaths: async () => [],
        },
      });
      await composition.repository.configureLocalNode(true);
      const deployment = new SshDeploymentService(composition, {
        async ensure(type) {
          await ensureGate;
          available = true;
          return { type, path: `/managed/${type}`, version: 'test', installed: true };
        },
      });

      await deployment.startDeployment('local');
      await expect(deployment.startDeployment('local')).rejects.toThrow('正在部署');
      releaseEnsure();
      await vi.waitFor(() => expect(deployment.getProgress('local')?.status).toBe('success'));
    } finally {
      releaseEnsure();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses a dedicated no-kernels state after the listener is ready', () => {
    expect(assessNodeDeployment(runtimeNode({
      configuredKernels: [],
      listener: { deployed: true, listening: true },
      kernels: [],
    }))).toMatchObject({ status: 'no_kernels', message: '暂无内核', progress: 0 });
  });

  it('requires the listener program to be deployed and listening', () => {
    expect(assessNodeDeployment(runtimeNode({ listener: { deployed: false, listening: false } })))
      .toMatchObject({ status: 'error', message: '监听程序未部署', progress: 10 });
    expect(assessNodeDeployment(runtimeNode({ listener: { deployed: true, listening: false, error: '端口未监听' } })))
      .toMatchObject({ status: 'error', message: '监听程序未成功监听：端口未监听', progress: 25 });
    expect(assessNodeDeployment(runtimeNode({
      configuredKernels: [], listener: { deployed: false, listening: false }, kernels: [],
    }))).toMatchObject({ status: 'error', message: '监听程序未部署', progress: 10 });
  });

  it('requires every configured kernel to be deployed, monitored, and accessible', () => {
    expect(assessNodeDeployment(runtimeNode({
      configuredKernels: [{ type: 'sing-box' }, { type: 'xray' }],
      kernels: [
        { type: 'sing-box', detected: false, monitored: true, accessible: false, nodesCount: 0, configPaths: [], error: '安装失败' },
        { type: 'xray', detected: true, monitored: false, accessible: true, nodesCount: 0, configPaths: [] },
      ],
    }))).toMatchObject({ status: 'error', message: '内核未就绪：sing-box 未部署：安装失败；xray 未监听', progress: 50 });
  });

  it('reports 100 percent only when listener and every configured kernel are ready', () => {
    expect(assessNodeDeployment(runtimeNode())).toMatchObject({
      status: 'success',
      message: '监听程序正常，1 个已配置内核全部就绪',
      progress: 100,
    });
  });

  it('builds an actionable deployment SOP from prerequisites, listener, and kernels', () => {
    expect(planNodeDeployment(runtimeNode(), {})).toMatchObject({
      preflightReady: true,
      deployable: true,
      ready: true,
      recommendedScope: null,
      blockers: [],
    });
    expect(planNodeDeployment(runtimeNode({
      nodeId: 'edge-1', kind: 'child',
      listener: { deployed: false, listening: false },
      kernels: [{ type: 'sing-box', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] }],
    }), { sshConfigured: true, credentialAvailable: true })).toMatchObject({
      preflightReady: true,
      deployable: true,
      ready: false,
      recommendedScope: 'all',
    });
  });

  it('blocks full deployment when SSH credentials or kernel configuration are missing', () => {
    const missingSsh = planNodeDeployment(runtimeNode({ nodeId: 'edge-1', kind: 'child' }), {
      sshConfigured: false,
      credentialAvailable: false,
    });
    expect(missingSsh).toMatchObject({ deployable: false, recommendedScope: null });
    expect(missingSsh.blockers).toContain('未配置 SSH 连接信息');

    const noKernels = planNodeDeployment(runtimeNode({ configuredKernels: [], kernels: [] }));
    expect(noKernels).toMatchObject({ deployable: false, ready: false, recommendedScope: null });
    expect(noKernels.blockers[0]).toContain('未配置内核');
  });
});
