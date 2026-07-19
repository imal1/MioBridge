import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/e2e.js';

function agentCard(page: Page, name: string) {
  return page.locator('.signal-core').filter({ hasText: name }).filter({ hasText: '监听端口' }).first();
}

function runtimeCard(page: Page, name: string) {
  return page.locator('.signal-core').filter({ hasText: name }).filter({ hasText: '二进制路径' }).first();
}

test.describe('E07 · Agent 运行维护', () => {
  test('运行中 Agent 可停止、启动、重启并立即健康检查', async ({ page, snapshot }) => {
    await page.goto('/agents?node=node-ready');
    const readyCard = agentCard(page, '上海边缘节点');
    await expect(readyCard).toBeVisible();
    await expect(readyCard.getByText('运行中', { exact: true })).toBeVisible();

    await readyCard.getByRole('button', { name: '停止', exact: true }).click();
    await expect(page.getByText('Agent 维护操作完成')).toBeVisible();
    await expect(readyCard.getByText('已停止', { exact: true })).toBeVisible();

    await readyCard.getByRole('button', { name: '启动', exact: true }).click();
    await expect(readyCard.getByText('运行中', { exact: true })).toBeVisible();
    await readyCard.getByRole('button', { name: '重启', exact: true }).click();
    await readyCard.getByRole('button', { name: '立即健康检查' }).click();
    await expect(page.getByText('健康检查完成')).toBeVisible();

    const state = await snapshot();
    for (const path of [
      '/api/cluster/agent/stop',
      '/api/cluster/agent/start',
      '/api/cluster/agent/restart',
    ]) {
      const request = state.requests.find(item => item.method === 'POST' && item.path === path);
      expect(request?.body).toMatchObject({ nodeId: 'node-ready' });
    }
    expect(state.requests.some(request => request.method === 'GET' && request.path.startsWith('/api/cluster/health'))).toBeTruthy();
  });

  test('未部署 Agent 只有部署恢复路径，没有运行维护按钮', async ({ page }) => {
    await page.goto('/agents?node=node-empty');
    const nodeCard = agentCard(page, '待部署节点');
    await expect(nodeCard).toBeVisible();
    await expect(nodeCard.getByText('未安装', { exact: true })).toBeVisible();
    await expect(nodeCard.getByRole('link', { name: '前往部署' })).toHaveAttribute('href', /node=node-empty.*component=agent/);
    await expect(nodeCard.getByRole('button', { name: /启动|停止|重启/ })).toHaveCount(0);
  });

  test('Agent API 业务失败必须展示错误且不伪装成功', async ({ page, control }) => {
    await control({ agentFailure: true });
    await page.goto('/agents?node=node-ready');
    const readyCard = agentCard(page, '上海边缘节点');
    await readyCard.getByRole('button', { name: '停止', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Agent 操作失败' })).toBeVisible();
    await expect(readyCard.getByText('运行中', { exact: true })).toBeVisible();
  });

  test('日志和部署维护链接携带唯一节点上下文', async ({ page }) => {
    await page.goto('/agents?node=node-ready');
    const readyCard = agentCard(page, '上海边缘节点');
    await expect(readyCard.getByRole('link', { name: '查看日志' })).toHaveAttribute('href', '/logs?node=node-ready');
    await expect(readyCard.getByRole('link', { name: '修复/升级/卸载' })).toHaveAttribute('href', /node=node-ready.*component=agent.*operation=repair/);
  });

  test('Agent 卡片展示最近错误，便于从异常状态进入恢复链路', async ({ page }) => {
    test.fail(true, '当前 Agent 页面没有渲染 PRD 要求的最近错误字段');
    await page.goto('/agents?node=node-ready');
    const readyCard = agentCard(page, '上海边缘节点');
    await expect(readyCard.getByText('最近错误', { exact: true })).toBeVisible();
  });
});

test.describe('E08–E09 · 协议运行时与监控事务', () => {
  test('检测严格展示三种内核、版本、路径、来源和 mihomo CLI 模式', async ({ page }) => {
    await page.goto('/runtimes?node=node-ready');
    await expect(page.getByText('CLI 转换器（无需常驻服务）', { exact: false })).toBeVisible();
    const singBox = runtimeCard(page, 'sing-box');
    const xray = runtimeCard(page, 'Xray');
    const v2ray = runtimeCard(page, 'V2Ray');
    await expect(singBox.getByText('sing-box', { exact: true })).toBeVisible();
    await expect(xray.getByText('Xray', { exact: true })).toBeVisible();
    await expect(v2ray.getByText('V2Ray', { exact: true })).toBeVisible();
    await expect(singBox.getByText('1.12.0-e2e', { exact: true })).toBeVisible();
    await expect(xray.getByText('25.1-e2e', { exact: true })).toBeVisible();
    await expect(v2ray.getByText('尚未检测到版本', { exact: true })).toBeVisible();
    await expect(singBox.getByText('/opt/e2e/sing-box.json', { exact: true })).toBeVisible();
    await expect(singBox.getByText('可读', { exact: true })).toBeVisible();
    await expect(singBox.getByText('3', { exact: true })).toBeVisible();
  });

  for (const [label, action] of [['启动', 'start'], ['停止', 'stop'], ['重启', 'restart']] as const) {
    test(`sing-box ${label} 走明确节点/核心/action 边界`, async ({ page, snapshot }) => {
      await page.goto('/runtimes?node=node-ready');
      const singBox = runtimeCard(page, 'sing-box');
      await expect(singBox.getByText('sing-box', { exact: true })).toBeVisible();
      await singBox.getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByText(`sing-box ${action} 完成`)).toBeVisible();
      const state = await snapshot();
      const request = state.requests.find(item => item.method === 'POST' && item.path === '/api/cluster/kernel/action');
      expect(request?.body).toMatchObject({ nodeId: 'node-ready', kernelType: 'sing-box', action });
    });
  }

  test('切换目标节点会清空旧检测并显示 Agent 恢复路径', async ({ page }) => {
    await page.goto('/runtimes?node=node-ready');
    await page.getByLabel('目标节点').selectOption('node-empty');
    await expect(page).toHaveURL(/node=node-empty/);
    await expect(page.getByText('Agent 不可用')).toBeVisible();
    await expect(page.getByRole('button', { name: '编辑监控范围与路径' })).toBeDisabled();
  });

  test('运行时检测失败不会保留旧检测结果，并显示明确恢复错误', async ({ page, control }) => {
    await control({ kernelFailure: true });
    await page.goto('/runtimes?node=node-ready');
    await expect(page.getByRole('heading', { name: '运行时操作失败' })).toBeVisible();
    await expect(page.getByText(/API Error 500|运行时检测失败/).first()).toBeVisible();
    await expect(runtimeCard(page, 'sing-box').getByText('未安装', { exact: true })).toBeVisible();
  });

  test('协议核心动作失败保留原状态并展示错误', async ({ page, control, snapshot }) => {
    await page.goto('/runtimes?node=node-ready');
    const singBox = runtimeCard(page, 'sing-box');
    await expect(singBox.getByText('可读', { exact: true })).toBeVisible();
    // 「可读」来自集群状态，检测结果尚未回来时也会显示；必须等运行维护按钮出现，
    // 否则 kernelFailure 会打断仍在飞行中的首次检测，按钮永远不会渲染。
    const stop = singBox.getByRole('button', { name: '停止', exact: true });
    await expect(stop).toBeVisible();
    await control({ kernelFailure: true });
    await stop.click();
    await expect(page.getByRole('heading', { name: '运行时操作失败' })).toBeVisible();
    await expect(page.getByText(/API Error 500|协议核心维护失败/).first()).toBeVisible();

    const state = await snapshot();
    const ready = state.nodes.find(node => node.nodeId === 'node-ready');
    const kernels = ready?.kernels as Array<Record<string, unknown>> | undefined;
    expect(kernels?.find(kernel => kernel.type === 'sing-box')).toMatchObject({ accessible: true });
  });

  test('保存监控范围是一次原子更新并重新检测', async ({ page, snapshot }) => {
    await page.goto('/runtimes?node=node-ready');
    await page.getByRole('button', { name: '编辑监控范围与路径' }).click();
    await expect(page.getByRole('dialog', { name: '选择监听内核' })).toBeVisible();
    await page.getByLabel('Xray 加入监听').check();
    await page.getByRole('button', { name: '保存并验证监控配置' }).click();
    await expect(page.getByText('监控配置已写入远端并通过 Agent 验证')).toBeVisible();

    // 成功 toast 在 refreshCluster/detect 之前就弹出，立刻取快照会漏掉复检请求。
    await expect.poll(async () => (await snapshot()).requests
      .filter(request => request.method === 'POST' && request.path === '/api/cluster/kernel/detect').length)
      .toBe(2);

    const state = await snapshot();
    const writes = state.requests.filter(request => request.method === 'PUT' && request.path === '/api/cluster/nodes');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toMatchObject({ nodeId: 'node-ready' });
  });

  test('未修改监控项时必须保留既有自定义配置路径', async ({ page, snapshot }) => {
    test.fail(true, '当前监控对话框会把自定义路径替换为检测到的默认路径');
    await page.goto('/runtimes?node=node-ready');
    await expect(page.getByText('sing-box · /opt/e2e/sing-box.json')).toBeVisible();
    await page.getByRole('button', { name: '编辑监控范围与路径' }).click();
    await page.getByRole('button', { name: '保存并验证监控配置' }).click();

    const state = await snapshot();
    const write = state.requests.find(request => request.method === 'PUT' && request.path === '/api/cluster/nodes');
    expect(write?.body).toMatchObject({
      kernels: expect.arrayContaining([{ type: 'sing-box', configPath: '/opt/e2e/sing-box.json' }]),
    });
  });

  test('监控事务失败保留旧控制面状态并显示恢复错误', async ({ page, control, snapshot }) => {
    await control({ monitoringFailure: true });
    await page.goto('/runtimes?node=node-ready');
    await page.getByRole('button', { name: '编辑监控范围与路径' }).click();
    await page.getByLabel('Xray 加入监听').check();
    await page.getByRole('button', { name: '保存并验证监控配置' }).click();
    // 保存失败后对话框保持打开，错误必须显示在对话框内部：
    // 页面底层的告警被模态框遮挡，用户看不到。
    const dialog = page.getByRole('dialog', { name: '选择监听内核' });
    await expect(dialog.getByText('Agent 监控配置验证失败（E2E fixture）')).toBeVisible();
    const state = await snapshot();
    const ready = state.nodes.find(node => node.nodeId === 'node-ready');
    expect(ready?.configuredKernels).toEqual([{ type: 'sing-box', configPath: '/opt/e2e/sing-box.json' }]);
  });

  test('协议核心展示真实运行态而不只展示配置可读性', async ({ page }) => {
    test.fail(true, '当前运行时页面没有渲染 running/stopped/degraded/error 运行态');
    await page.goto('/runtimes?node=node-ready');
    const singBox = runtimeCard(page, 'sing-box');
    await expect(singBox.getByText('运行状态', { exact: true })).toBeVisible();
    await expect(singBox.getByText('running', { exact: true })).toBeVisible();
  });

  test('协议核心展示组件状态接口返回的真实二进制路径', async ({ page }) => {
    test.fail(true, '当前运行时页面硬编码 /usr/local/bin/<type>，没有读取真实组件路径');
    await page.goto('/runtimes?node=node-ready');
    const singBox = runtimeCard(page, 'sing-box');
    await expect(singBox.getByText('/opt/e2e/bin/sing-box', { exact: true })).toBeVisible();
  });
});
