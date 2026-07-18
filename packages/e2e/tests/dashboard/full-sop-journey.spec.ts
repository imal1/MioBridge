import type { APIRequestContext, APIResponse, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/e2e.js';

interface Envelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly requestId: string;
  readonly role: 'admin';
}

interface LegacyResponse<T> {
  readonly success: boolean;
  readonly data: T;
  readonly timestamp: string;
}

async function envelope<T>(response: APIResponse, status = 200): Promise<Envelope<T>> {
  const source = await response.text();
  expect(response.status(), source).toBe(status);
  const body = JSON.parse(source) as Envelope<T>;
  expect(body).toMatchObject({ success: true, requestId: expect.any(String), role: 'admin' });
  return body;
}

async function legacyResponse<T>(response: APIResponse, status = 200): Promise<LegacyResponse<T>> {
  const source = await response.text();
  expect(response.status(), source).toBe(status);
  const body = JSON.parse(source) as LegacyResponse<T>;
  expect(body).toMatchObject({ success: true, timestamp: expect.any(String) });
  return body;
}

async function successData<T>(response: APIResponse, status = 200): Promise<{ success: true; data: T }> {
  const source = await response.text();
  expect(response.status(), source).toBe(status);
  const body = JSON.parse(source) as { success: boolean; data: T };
  expect(body).toMatchObject({ success: true, data: expect.anything() });
  return body as { success: true; data: T };
}

function card(page: Page, name: string, marker: string) {
  return page.locator('.signal-core').filter({ hasText: name }).filter({ hasText: marker }).first();
}

async function waitForDeployment(request: APIRequestContext, taskId: string) {
  let result: Record<string, unknown> | undefined;
  await expect.poll(async () => {
    const body = await envelope<Record<string, unknown>>(await request.get(`/api/deployments/${taskId}`));
    result = body.data;
    return result.status;
  }, { timeout: 15_000 }).toBe('success');
  return result!;
}

async function waitForSubscription(request: APIRequestContext, jobId: string) {
  let result: Record<string, unknown> | undefined;
  await expect.poll(async () => {
    const body = await envelope<Record<string, unknown>>(await request.get(`/api/subscription-jobs/${jobId}`));
    result = body.data;
    return result.status;
  }, { timeout: 15_000 }).toMatch(/succeeded|partial/);
  return result!;
}

test('E20 · 完整串行 SOP：节点 → Agent → 内核 → 订阅 → 产物 → 策略 → 日志 → API', async ({ page, request }) => {
  const host = 'full-sop-node.e2e.invalid';

  const hostKey = await test.step('1. SSH 九项预检并确认主机指纹', async () => {
    const preflight = await legacyResponse<{
      hostKey: string;
      architecture: string;
      checks: Array<{ ok: boolean }>;
    }>(await request.post('/api/cluster/nodes/preflight', {
      data: {
        ssh: { host, user: 'root', port: 22, authMethod: 'password', password: 'fixture-only' },
      },
    }));
    expect(preflight.data.checks).toHaveLength(9);
    expect(preflight.data.checks.every(check => check.ok)).toBeTruthy();
    expect(preflight.data.hostKey).toBeTruthy();
    return preflight.data.hostKey;
  });

  const created = await legacyResponse<{ id: string }>(await request.post('/api/cluster/nodes', {
    data: {
      name: '完整 SOP 节点',
      host,
      location: 'E2E-ISOLATED',
      tags: ['e2e', 'full-sop'],
      kernels: [],
      sshUser: 'root',
      sshPort: 22,
      sshHostKey: hostKey,
      sshAuthMethod: 'password',
      sshPassword: 'fixture-only',
    },
  }), 201);
  expect(JSON.stringify(created.data)).not.toMatch(/"(?:secret|password|privateKey|credentialRef)"\s*:/i);
  const nodeId = created.data.id;
  await page.goto('/nodes');
  await expect(page.getByText('完整 SOP 节点', { exact: true })).toBeVisible();

  await test.step('2. 部署 Agent 并进入运行维护页', async () => {
    const started = await envelope<{ taskId: string }>(await request.post('/api/deployments', {
      headers: { 'Idempotency-Key': 'full-sop-agent-install' },
      data: {
        nodeId,
        component: 'agent',
        operation: 'install',
        options: { preserveConfig: true, preserveData: true },
      },
    }), 202);
    const task = await waitForDeployment(request, started.data.taskId);
    expect(task).toMatchObject({ nodeId, component: 'agent', operation: 'install', progress: 100 });

    await legacyResponse(await request.post('/api/cluster/agent/restart', { data: { nodeId } }));
    await legacyResponse(await request.get(`/api/cluster/health?node=${encodeURIComponent(nodeId)}`));
    await page.goto(`/agents?node=${encodeURIComponent(nodeId)}`);
    const agent = card(page, '完整 SOP 节点', '监听端口');
    await expect(agent).toBeVisible();
    await expect(agent.getByText('运行中', { exact: true })).toBeVisible();
  });

  const kernelTaskId = await test.step('3. 部署 sing-box 并原子配置 Agent 监控', async () => {
    const started = await envelope<{ taskId: string }>(await request.post('/api/deployments', {
      headers: { 'Idempotency-Key': 'full-sop-singbox-install' },
      data: {
        nodeId,
        component: 'sing-box',
        operation: 'install',
        options: { preserveConfig: true, preserveData: true },
      },
    }), 202);
    await waitForDeployment(request, started.data.taskId);
    const updated = await legacyResponse<Record<string, unknown>>(await request.put('/api/cluster/nodes', {
      data: { nodeId, kernels: [{ type: 'sing-box', configPath: '/etc/sing-box/config.json' }] },
    }));
    expect(updated.data).toMatchObject({ id: nodeId });

    await page.goto(`/runtimes?node=${encodeURIComponent(nodeId)}`);
    const singBox = card(page, 'sing-box', '二进制路径');
    await expect(singBox.getByText('sing-box', { exact: true })).toBeVisible();
    await expect(singBox.getByText('/etc/sing-box/config.json', { exact: true })).toBeVisible();
    return started.data.taskId;
  });

  const jobId = await test.step('4. 预检并运行完整订阅生成管线', async () => {
    const preflight = await envelope<{ ready: boolean; sourcesTotal: number }>(
      await request.post('/api/subscription-jobs/preflight'),
    );
    expect(preflight.data.ready).toBeTruthy();
    expect(preflight.data.sourcesTotal).toBeGreaterThan(0);

    const started = await envelope<{ jobId: string }>(await request.post('/api/subscription-jobs', {
      headers: { 'Idempotency-Key': 'full-sop-subscription' },
    }), 202);
    const job = await waitForSubscription(request, started.data.jobId);
    expect(job).toMatchObject({ progress: 100, step: 'done' });
    return started.data.jobId;
  });

  await test.step('5. 校验并分发三个正式产物', async () => {
    const artifacts = await envelope<{ artifacts: Array<{ name: string; exists: boolean; valid: boolean }> }>(
      await request.post('/api/artifacts/validate', { data: {} }),
    );
    expect(artifacts.data.artifacts).toHaveLength(3);
    expect(artifacts.data.artifacts.every(item => item.exists && item.valid)).toBeTruthy();

    for (const [path, contentType] of [
      ['/raw.txt', 'text/plain'],
      ['/subscription.txt', 'text/plain'],
      ['/clash.yaml', 'text/yaml'],
    ] as const) {
      const response = await request.get(path);
      expect(response.ok(), path).toBeTruthy();
      expect(response.headers()['content-type']).toContain(contentType);
      expect((await response.text()).length).toBeGreaterThan(0);
    }
    await page.goto('/outputs');
    await expect(page.getByText('3/3 个产物有效')).toBeVisible();
  });

  await test.step('6. 保存订阅策略并验证持久化回读', async () => {
    const current = await envelope<Record<string, unknown>>(await request.get('/api/subscription-policy'));
    const next = { ...current.data, enabled: true, cron: '*/30 * * * *', freshnessHours: 12, nodeDropPercent: 25 };
    await envelope(await request.put('/api/subscription-policy', { data: next }));
    const reread = await envelope<Record<string, unknown>>(await request.get('/api/subscription-policy'));
    expect(reread.data).toMatchObject(next);
  });

  await test.step('7. 部署/订阅日志可按任务唯一定位', async () => {
    const deploymentLog = await successData<{ lines: string[] }>(await request.get(
      `/api/logs?source=deployment&taskId=${encodeURIComponent(kernelTaskId)}`,
    ));
    expect(deploymentLog.data.lines.length).toBeGreaterThan(0);
    const subscriptionLog = await successData<{ lines: string[] }>(await request.get(
      `/api/logs?source=subscription&taskId=${encodeURIComponent(jobId)}`,
    ));
    expect(subscriptionLog.data.lines.length).toBeGreaterThan(0);

    await page.goto(`/logs?source=deployment&taskId=${encodeURIComponent(kernelTaskId)}`);
    await expect(page.getByRole('heading', { level: 1, name: '日志' })).toBeVisible();
    await expect(page.locator('.signal-terminal:visible')).not.toHaveText('暂无日志内容');
  });

  await test.step('8. 动态 API 契约仍可作为集成入口', async () => {
    const openapi = await request.get('/api/openapi.json');
    expect(openapi.ok()).toBeTruthy();
    const document = await openapi.json() as { openapi: string; paths: Record<string, unknown> };
    expect(document.openapi).toMatch(/^3\./);
    expect(Object.keys(document.paths).length).toBeGreaterThanOrEqual(40);
    expect(document.paths).toHaveProperty('/api/deployments');
    expect(document.paths).toHaveProperty('/api/subscription-jobs');

    await page.goto('/api-docs');
    await expect(page.getByRole('heading', { level: 1, name: 'API' })).toBeVisible();
    await expect(page.getByText('/api/deployments', { exact: true }).first()).toBeVisible();
  });
});

test('E20 契约缺口 · /api/logs 使用规范 ApiEnvelope role：admin', async ({ request }) => {
  test.fail(true, '当前日志路由缺少规范 ApiEnvelope 的 role：admin');
  const response = await request.get('/api/logs?source=control');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    success: true,
    data: expect.anything(),
    requestId: expect.any(String),
    role: 'admin',
  });
});
