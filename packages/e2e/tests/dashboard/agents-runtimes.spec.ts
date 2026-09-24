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
    // 停止/启动/重启共用同一条成功文案，前一条还没消失就会有多个同名 toast。
    await expect(page.getByText('Agent 维护操作完成').first()).toBeVisible();
    // The fixture flips agent.status to stopped, so the control swaps to 启动.
    const start = panel.getByRole('button', { name: '启动', exact: true });
    await expect(start).toBeVisible();

    await start.click();
    await expect(panel.getByRole('button', { name: '停止', exact: true })).toBeVisible();

    await panel.getByRole('button', { name: '重启', exact: true }).click();
    await expect(page.getByText('Agent 维护操作完成').first()).toBeVisible();

    await panel.getByRole('button', { name: '健康检查', exact: true }).click();
    await expect(page.getByText('健康检查完成').first()).toBeVisible();

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

  test('在线 Agent 将最近错误标记为已恢复', async ({ page }) => {
    const panel = await openNode(page, 'node-ready', READY_NAME, 'Agent');
    await expect(panel.getByText('历史错误（当前已恢复）', { exact: true })).toBeVisible();
  });

  test('显式体检展示原因与建议，修复后重新验收且不自动迁移', async ({ page, control, snapshot }) => {
    await control({ maintenanceLingerDisabled: true });
    const panel = await openNode(page, 'node-ready', READY_NAME, 'Agent');
    const maintenance = panel.getByRole('region', { name: '节点体检与修复' });
    const repair = maintenance.getByRole('button', { name: '一键修复', exact: true });
    await expect(repair).toBeDisabled();
    expect((await snapshot()).requests.filter(item => /\/(diagnostics|repair|migrate-service)$/.test(item.path))).toEqual([]);

    await maintenance.getByRole('button', { name: '开始体检', exact: true }).click();
    const checks = maintenance.getByRole('list', { name: '体检结果' });
    await expect(checks).toContainText('用户服务将在退出登录后失去持久运行保障');
    await expect(checks).toContainText('启用运行用户的 Linger 后重新验收');
    await expect(checks).toContainText('公开 HTTP + HMAC 健康检查通过');
    await expect(repair).toBeEnabled();
    expect((await snapshot()).requests.filter(item => /\/(repair|migrate-service)$/.test(item.path))).toEqual([]);

    await repair.click();
    await expect(maintenance.getByRole('status').filter({ hasText: '修复完成' })).toHaveText('修复完成，断线存活验收通过');
    await expect(checks).not.toContainText('用户服务将在退出登录后失去持久运行保障');
    await expect(repair).toBeDisabled();
    const state = await snapshot();
    expect(state.requests.filter(item => item.method === 'POST' && /\/(diagnostics|repair)$/.test(item.path)).map(item => item.path)).toEqual([
      '/api/cluster/nodes/node-ready/diagnostics', '/api/cluster/nodes/node-ready/repair',
    ]);
    expect(state.requests.some(item => item.path.endsWith('/migrate-service'))).toBeFalsy();
    expect(state.nodes.find(node => node.nodeId === 'node-ready')).toMatchObject({ agent: { serviceMode: 'user' } });
  });

  test('体检请求失败显示明确错误且不放行一键修复', async ({ page, control }) => {
    await control({ maintenanceDiagnosticsFailure: true });
    const panel = await openNode(page, 'node-ready', READY_NAME, 'Agent');
    const maintenance = panel.getByRole('region', { name: '节点体检与修复' });
    await maintenance.getByRole('button', { name: '开始体检', exact: true }).click();
    await expect(maintenance.getByRole('alert')).toHaveText('节点体检失败：SSH 连接不可用（E2E fixture）');
    await expect(maintenance.getByRole('button', { name: '一键修复', exact: true })).toBeDisabled();
  });

  test('修复后的公开验收失败保留异常且不显示完成', async ({ page, control, snapshot }) => {
    await control({ maintenanceLingerDisabled: true, maintenanceAcceptanceFailure: true });
    const panel = await openNode(page, 'node-ready', READY_NAME, 'Agent');
    const maintenance = panel.getByRole('region', { name: '节点体检与修复' });
    await maintenance.getByRole('button', { name: '开始体检', exact: true }).click();
    await maintenance.getByRole('button', { name: '一键修复', exact: true }).click();
    await expect(maintenance.getByRole('alert')).toHaveText('修复后公网 HMAC 验收失败（E2E fixture）');
    await expect(maintenance.getByRole('list', { name: '体检结果' })).toContainText('公开健康接口不可达');
    await expect(maintenance.getByText('修复完成，断线存活验收通过', { exact: true })).toHaveCount(0);
    expect((await snapshot()).requests.filter(item => item.path === '/api/cluster/nodes/node-ready/repair')).toHaveLength(1);
  });

  test('系统服务迁移须指定非 root 用户并显式提交，完成后隐藏迁移入口', async ({ page, snapshot }) => {
    const panel = await openNode(page, 'node-ready', READY_NAME, 'Agent');
    const maintenance = panel.getByRole('region', { name: '节点体检与修复' });
    await expect(maintenance).toContainText('用户级服务');
    await maintenance.getByRole('button', { name: '迁移至系统级服务', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '迁移至系统级服务' });
    await dialog.getByLabel('非特权运行用户').fill('root');
    await expect(dialog.getByRole('button', { name: '开始迁移', exact: true })).toBeDisabled();
    await dialog.getByLabel('非特权运行用户').fill('agent-runner');
    await expect(dialog.getByRole('button', { name: '开始迁移', exact: true })).toBeEnabled();
    expect((await snapshot()).requests.some(item => item.path.endsWith('/migrate-service'))).toBeFalsy();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect((await snapshot()).requests.some(item => item.path.endsWith('/migrate-service'))).toBeFalsy();

    await maintenance.getByRole('button', { name: '迁移至系统级服务', exact: true }).click();
    await dialog.getByRole('button', { name: '开始迁移', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(maintenance.getByRole('status').filter({ hasText: '迁移完成' })).toHaveText('迁移完成，断线存活验收通过');
    await expect(maintenance).toContainText('系统级服务 · agent-runner');
    await expect(maintenance.getByRole('button', { name: '迁移至系统级服务', exact: true })).toHaveCount(0);
    const state = await snapshot();
    expect(state.requests.filter(item => item.path === '/api/cluster/nodes/node-ready/migrate-service')).toMatchObject([
      { method: 'POST', body: { runtimeUser: 'agent-runner' } },
    ]);
    expect(state.nodes.find(node => node.nodeId === 'node-ready')).toMatchObject({ agent: { serviceMode: 'system', runtimeUser: 'agent-runner' } });
    await page.reload();
    await panel.getByRole('button', { name: 'Agent', exact: true }).click();
    await expect(maintenance).toContainText('系统级服务');
    await expect(maintenance.getByRole('button', { name: '迁移至系统级服务', exact: true })).toHaveCount(0);
  });

  test('迁移验收失败报告回滚并保留用户级服务', async ({ page, control, snapshot }) => {
    await control({ maintenanceAcceptanceFailure: true });
    const panel = await openNode(page, 'node-ready', READY_NAME, 'Agent');
    const maintenance = panel.getByRole('region', { name: '节点体检与修复' });
    await maintenance.getByRole('button', { name: '迁移至系统级服务', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '迁移至系统级服务' });
    await dialog.getByLabel('非特权运行用户').fill('agent-runner');
    await dialog.getByRole('button', { name: '开始迁移', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('迁移后公网 HMAC 验收失败；已恢复迁移前的用户级服务（E2E fixture）');
    await expect(maintenance.getByText('迁移完成，断线存活验收通过', { exact: true })).toHaveCount(0);
    expect((await snapshot()).nodes.find(node => node.nodeId === 'node-ready')).toMatchObject({ agent: { serviceMode: 'user', runtimeUser: 'miobridge' } });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(maintenance.getByRole('button', { name: '迁移至系统级服务', exact: true })).toBeVisible();
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
