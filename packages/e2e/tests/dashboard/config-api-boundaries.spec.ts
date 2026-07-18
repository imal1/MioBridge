import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '../../fixtures/e2e.js';

type EffectiveConfigResponse = {
  readonly data: { readonly config: Readonly<Record<string, unknown>> };
};

async function effectiveConfig(request: APIRequestContext) {
  const response = await request.get('/api/config/effective');
  expect(response.ok()).toBeTruthy();
  return (await response.json() as EffectiveConfigResponse).data.config;
}

test.describe('E16 · 配置失败边界', () => {
  test('原子保存失败后后端 effective 不变，页面保留待恢复草稿', async ({ page, request, control }) => {
    const before = await effectiveConfig(request);
    await control({ configSaveFailure: true });
    await page.goto('/config');
    const port = page.getByLabel('app.port');
    await port.fill('4401');
    await page.getByRole('button', { name: '原子保存全部差异' }).click();

    await expect(page.getByRole('heading', { name: '配置操作失败' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '字段差异' })).toBeVisible();
    await expect(port).toHaveValue('4401');
    expect(await effectiveConfig(request)).toEqual(before);
  });
});

test.describe('E17 · 配置导入与恢复边界', () => {
  test('非法 YAML 导入必须显示就地错误且不改变生效配置', async ({ page, request }) => {
    const before = await effectiveConfig(request);
    await page.goto('/config');
    await page.getByPlaceholder('粘贴 YAML 配置，仅执行预览').fill('app: [unterminated');
    await page.getByRole('button', { name: '预览导入差异' }).click();
    await expect(page.getByRole('heading', { name: '配置操作失败' })).toBeVisible();
    await expect(page.getByText(/YAML|导入文件无效/).first()).toBeVisible();
    expect(await effectiveConfig(request)).toEqual(before);
  });

  test('取消恢复确认不会调用恢复接口或改变当前配置', async ({ page, request, snapshot }) => {
    const changed = await request.patch('/api/config', {
      data: { changes: [{ path: 'app.port', value: 4402 }] },
    });
    expect(changed.ok()).toBeTruthy();
    await page.goto('/config');
    await expect(page.getByLabel('app.port')).toHaveValue('4402');

    page.once('dialog', dialog => void dialog.dismiss());
    await page.getByRole('button', { name: '恢复 last-good' }).click();
    await expect(page.getByLabel('app.port')).toHaveValue('4402');
    const state = await snapshot();
    expect(state.requests.filter(item => item.method === 'POST' && item.path === '/api/config/restore')).toEqual([]);
  });

  test('恢复失败不改变 effective 配置', async ({ page, request, control }) => {
    test.fail(true, '当前恢复操作没有捕获 HTTP 异常，失败响应无法进入页面错误态');
    const changed = await request.patch('/api/config', {
      data: { changes: [{ path: 'app.port', value: 4403 }] },
    });
    expect(changed.ok()).toBeTruthy();
    const before = await effectiveConfig(request);
    await control({ configRestoreFailure: true });
    await page.goto('/config');
    page.once('dialog', dialog => void dialog.accept());
    await page.getByRole('button', { name: '恢复 last-good' }).click();

    await expect(page.getByRole('heading', { name: '配置操作失败' })).toBeVisible();
    expect(await effectiveConfig(request)).toEqual(before);
  });
});

test.describe('E18 · Webhook 禁用、网络与空历史', () => {
  test('Webhook 未启用时拒绝发送且不产生投递记录', async ({ page, request, snapshot }) => {
    const disabled = await request.patch('/api/config', {
      data: { changes: [{ path: 'notifications.webhook.enabled', value: false }] },
    });
    expect(disabled.ok()).toBeTruthy();
    await page.goto('/config');
    await page.getByRole('button', { name: '发送测试通知' }).click();
    await expect(page.getByRole('heading', { name: '配置操作失败' })).toBeVisible();
    expect((await snapshot()).webhooks).toEqual([]);
  });

  test('Webhook 网络失败被隔离守卫拦截并呈现错误', async ({ page, request, snapshot }) => {
    const external = await request.patch('/api/config', {
      data: { changes: [{ path: 'notifications.webhook.url', value: 'https://blocked.e2e.invalid/hook' }] },
    });
    expect(external.ok()).toBeTruthy();
    await page.goto('/config');
    await page.getByRole('button', { name: '发送测试通知' }).click();
    await expect(page.getByRole('heading', { name: '配置操作失败' })).toBeVisible();
    expect((await snapshot()).webhooks).toEqual([]);
  });

  test('空通知历史有明确空态且刷新请求可达', async ({ page, snapshot }) => {
    await page.goto('/config');
    await expect(page.getByText('尚未加载通知投递历史。')).toBeVisible();
    await page.getByRole('button', { name: '刷新历史' }).click();
    await expect(page.getByText('尚未加载通知投递历史。')).toBeVisible();
    const state = await snapshot();
    expect(state.requests.some(item => item.method === 'GET' && item.path === '/api/notifications/history')).toBeTruthy();
  });
});

test.describe('E19 · OpenAPI 打开与异常文档', () => {
  test('打开 GET 真实访问同源只读端点', async ({ page }) => {
    await page.goto('/api-docs');
    const trigger = page.getByRole('button').filter({ has: page.getByText('/health', { exact: true }) });
    await trigger.click();
    const endpoint = trigger.locator('..');
    const popupPromise = page.waitForEvent('popup');
    await endpoint.getByRole('link', { name: '打开 GET' }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup).toHaveURL(/\/health$/);
    await expect(popup.locator('body')).toContainText('healthy');
    await popup.close();
  });

  test('非法 OpenAPI 文档进入可恢复错误态', async ({ page }) => {
    await page.route('**/api/openapi.json', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ openapi: '3.1.0', info: { title: 'invalid fixture' }, paths: null }),
    }));
    await page.goto('/api-docs');
    await expect(page.getByText('无法读取 API 契约')).toBeVisible();
    await expect(page.getByText('服务端未返回有效的 OpenAPI 文档')).toBeVisible();
  });

  test('合法空 paths 文档显示明确空态而非崩溃', async ({ page }) => {
    await page.route('**/api/openapi.json', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ openapi: '3.1.0', info: { title: 'Empty API', version: 'e2e' }, paths: {} }),
    }));
    await page.goto('/api-docs');
    await expect(page.getByText('0 个端点 · ve2e')).toBeVisible();
    await expect(page.getByText('契约中没有可显示的 paths。')).toBeVisible();
  });
});
