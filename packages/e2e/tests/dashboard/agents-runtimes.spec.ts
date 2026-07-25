/**
 * Agent maintenance and protocol-runtime coverage.
 *
 * These used to drive standalone /agents and /runtimes pages. Both routes now
 * redirect to /nodes (and the redirect drops the query string), because each
 * former page became a tab on the node detail panel: 概览 / 部署 / Agent / 运行时.
 * The specs therefore navigate to /nodes?node=<id> and open the tab.
 *
 * Assertions for controls the redesign removed are gone rather than reworded:
 * per-kernel start/stop/restart buttons, the 目标节点 selector, the per-kernel
 * detail cards that exposed 二进制路径, and the 前往部署 / 修复/升级/卸载 links.
 * The API-boundary assertions those tests carried are kept wherever the current
 * UI still reaches the same endpoint.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures/e2e.js';

type DetailTab = '概览' | '部署' | 'Agent' | '运行时';

const READY_NAME = '上海边缘节点';
const EMPTY_NAME = '待部署节点';

/** The detail panel is the card carrying the selected node's name as a heading;
 *  the node table is the other `.mb-card` and only holds it as plain text. */
function detailPanel(page: Page, nodeName: string): Locator {
  return page.locator('.mb-card').filter({ has: page.getByRole('heading', { name: nodeName, exact: true }) });
}

async function openNode(page: Page, nodeId: string, nodeName: string, tab: DetailTab): Promise<Locator> {
  await page.goto(`/nodes?node=${encodeURIComponent(nodeId)}`);
  const panel = detailPanel(page, nodeName);
  await panel.getByRole('button', { name: tab, exact: true }).click();
  return panel;
}

/** RuntimeRow instances are the direct children of the runtime tab's list. */
function runtimeRow(panel: Locator, label: string): Locator {
  return panel.locator('div.flex.flex-col.gap-2 > div').filter({ hasText: label }).first();
}

test.describe('E07 · Agent 运行维护', () => {
  test('运行中 Agent 可停止、启动、重启并健康检查', async ({ page, snapshot }) => {
    const panel = await openNode(page, 'node-ready', READY_NAME, 'Agent');
    await expect(panel.getByText('1.0.0-e2e', { exact: true })).toBeVisible();
    await expect(panel.getByText('3001', { exact: true })).toBeVisible();

    await panel.getByRole('button', { name: '停止', exact: true }).click();
    await expect(page.getByText('Agent 维护操作完成')).toBeVisible();
    // The fixture flips agent.status to stopped, so the control swaps to 启动.
    const start = panel.getByRole('button', { name: '启动', exact: true });
    await expect(start).toBeVisible();

    await start.click();
    await expect(panel.getByRole('button', { name: '停止', exact: true })).toBeVisible();

    await panel.getByRole('button', { name: '重启', exact: true }).click();
    await expect(page.getByText('Agent 维护操作完成')).toBeVisible();

    await panel.getByRole('button', { name: '健康检查', exact: true }).click();
    await expect(page.getByText('健康检查完成')).toBeVisible();

    const state = await snapshot();
    for (const path of [
      '/api/cluster/agent/stop',
      '/api/cluster/agent/start',
      '/api/cluster/agent/restart',
    ]) {
      const request = state.requests.find(item => item.method === 'POST' && item.path === path);
      expect(request?.body, `${path} 未收到预期请求`).toMatchObject({ nodeId: 'node-ready' });
    }
    expect(state.requests.some(request => request.method === 'GET' && request.path.startsWith('/api/cluster/health'))).toBeTruthy();
  });

  test('未部署 Agent 没有运行维护按钮，只留部署标签作为恢复路径', async ({ page }) => {
    const panel = await openNode(page, 'node-empty', EMPTY_NAME, 'Agent');
    await expect(panel.getByRole('button', { name: /^(启动|停止|重启|健康检查)$/ })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '部署', exact: true })).toBeVisible();
  });

  test('Agent API 业务失败必须展示错误且不伪装成功', async ({ page, control }) => {
    await control({ agentFailure: true });
    const panel = await openNode(page, 'node-ready', READY_NAME, 'Agent');
    await panel.getByRole('button', { name: '停止', exact: true }).click();
    await expect(page.getByText('节点操作失败')).toBeVisible();
    await expect(page.getByText('Agent 操作失败（E2E fixture）')).toBeVisible();
    // State must not advance: the stop control is still the one on offer.
    await expect(panel.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  });

  test('日志链接携带唯一节点上下文', async ({ page }) => {
    const panel = await openNode(page, 'node-ready', READY_NAME, 'Agent');
    await expect(panel.getByRole('link', { name: '查看日志' })).toHaveAttribute('href', '/logs?node=node-ready');
  });

  test('Agent 标签展示最近错误，便于从异常状态进入恢复链路', async ({ page }) => {
    const panel = await openNode(page, 'node-ready', READY_NAME, 'Agent');
    await expect(panel.getByText('最近错误', { exact: true })).toBeVisible();
  });
});

test.describe('E08–E09 · 协议运行时与监控事务', () => {
  test('运行时标签展示 mihomo 与三种协议核心的纳管状态', async ({ page }) => {
    const panel = await openNode(page, 'node-ready', READY_NAME, '运行时');

    const mihomo = runtimeRow(panel, 'mihomo');
    await expect(mihomo).toContainText('可用');
    await expect(mihomo).toContainText('CLI 转换器');
    await expect(mihomo).toContainText('v1.19.0-e2e');

    const singBox = runtimeRow(panel, 'sing-box');
    await expect(singBox).toContainText('已监控');
    await expect(singBox).toContainText('/opt/e2e/sing-box.json');
    // Runtime truth, not just config readability: state, accessibility, sources.
    await expect(singBox).toContainText('运行中 · 可读 · 3 个来源');

    await expect(runtimeRow(panel, 'Xray')).toContainText('未监控');
  });

  test('未安装 Agent 的节点无法检测或编辑监控范围', async ({ page }) => {
    const panel = await openNode(page, 'node-empty', EMPTY_NAME, '运行时');
    await expect(panel.getByRole('button', { name: '重新检测', exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: '编辑监控范围', exact: true })).toBeDisabled();
  });

  test('运行时检测失败展示明确恢复错误且不放行监控编辑', async ({ page, control }) => {
    await control({ kernelFailure: true });
    const panel = await openNode(page, 'node-ready', READY_NAME, '运行时');
    await expect(page.getByText('节点操作失败')).toBeVisible();
    await expect(page.getByText('运行时检测失败（E2E fixture）')).toBeVisible();
    // No detections came back, so the editor stays shut rather than opening empty.
    await expect(panel.getByRole('button', { name: '编辑监控范围', exact: true })).toBeDisabled();
  });

  test('保存监控范围是一次原子更新并重新检测', async ({ page, snapshot }) => {
    const panel = await openNode(page, 'node-ready', READY_NAME, '运行时');
    await panel.getByRole('button', { name: '编辑监控范围', exact: true }).click();
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
    const panel = await openNode(page, 'node-ready', READY_NAME, '运行时');
    await expect(runtimeRow(panel, 'sing-box')).toContainText('/opt/e2e/sing-box.json');
    await panel.getByRole('button', { name: '编辑监控范围', exact: true }).click();
    await page.getByRole('button', { name: '保存并验证监控配置' }).click();

    const state = await snapshot();
    const write = state.requests.find(request => request.method === 'PUT' && request.path === '/api/cluster/nodes');
    expect(write?.body).toMatchObject({
      kernels: expect.arrayContaining([{ type: 'sing-box', configPath: '/opt/e2e/sing-box.json' }]),
    });
  });

  test('监控事务失败保留旧控制面状态并显示恢复错误', async ({ page, control, snapshot }) => {
    await control({ monitoringFailure: true });
    const panel = await openNode(page, 'node-ready', READY_NAME, '运行时');
    await panel.getByRole('button', { name: '编辑监控范围', exact: true }).click();
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
});
