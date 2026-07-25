/**
 * Configuration and notification failure boundaries.
 *
 * The config page lost its import-preview textarea and its webhook test/history
 * controls in the redesign; only schema-driven editing, 校验草稿, 导出脱敏配置 and
 * 恢复 last-good remain. The behaviours those controls used to exercise are still
 * server behaviours, so the tests now drive the endpoints directly instead of
 * being deleted along with the buttons. Failure banners are plain text rather
 * than headings, which is why the assertions no longer ask for a heading role.
 */
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '../../fixtures/e2e.js';

type EffectiveConfigResponse = {
  readonly data: { readonly config: Readonly<Record<string, unknown>> };
};

type ErrorEnvelope = {
  readonly success: boolean;
  readonly error?: { readonly code: string; readonly message: string };
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

    await expect(page.getByText('配置操作失败')).toBeVisible();
    // The draft survives the failure, so the pending diff is still on offer.
    await expect(page.getByText('1 个待保存差异')).toBeVisible();
    await expect(port).toHaveValue('4401');
    expect(await effectiveConfig(request)).toEqual(before);
  });
});

test.describe('E17 · 配置导入与恢复边界', () => {
  test('非法 YAML 导入被拒绝且不改变生效配置', async ({ request }) => {
    const before = await effectiveConfig(request);
    const response = await request.post('/api/config/import/preview', {
      data: { source: 'app: [unterminated' },
    });
    expect(response.status()).toBe(400);
    const body = await response.json() as ErrorEnvelope;
    expect(body.success).toBe(false);
    // 错误必须来自解析器本身并定位到出错位置，而不是笼统的“导入失败”。
    expect(body.error?.message).toMatch(/line \d+, column \d+/);
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
    const changed = await request.patch('/api/config', {
      data: { changes: [{ path: 'app.port', value: 4403 }] },
    });
    expect(changed.ok()).toBeTruthy();
    const before = await effectiveConfig(request);
    await control({ configRestoreFailure: true });
    await page.goto('/config');
    page.once('dialog', dialog => void dialog.accept());
    await page.getByRole('button', { name: '恢复 last-good' }).click();

    await expect(page.getByText('配置操作失败')).toBeVisible();
    expect(await effectiveConfig(request)).toEqual(before);
  });
});

test.describe('E18 · Webhook 禁用、网络与空历史', () => {
  test('Webhook 未启用时拒绝发送且不产生投递记录', async ({ request, snapshot }) => {
    const disabled = await request.patch('/api/config', {
      data: { changes: [{ path: 'notifications.webhook.enabled', value: false }] },
    });
    expect(disabled.ok()).toBeTruthy();

    const response = await request.post('/api/notifications/test');
    expect(response.status()).toBe(400);
    expect((await response.json() as ErrorEnvelope).error?.message).toContain('Webhook 尚未启用');
    expect((await snapshot()).webhooks).toEqual([]);
  });

  test('Webhook 网络失败被隔离守卫拦截并呈现错误', async ({ request, snapshot }) => {
    const external = await request.patch('/api/config', {
      data: { changes: [{ path: 'notifications.webhook.url', value: 'https://blocked.e2e.invalid/hook' }] },
    });
    expect(external.ok()).toBeTruthy();

    const response = await request.post('/api/notifications/test');
    expect(response.status()).toBe(400);
    // The harness blocks any egress off its own origin; nothing may be delivered.
    expect((await response.json() as ErrorEnvelope).error?.message).toContain('blocked external fetch');
    expect((await snapshot()).webhooks).toEqual([]);
  });

  test('空通知历史返回明确空集合', async ({ request }) => {
    const response = await request.get('/api/notifications/history');
    expect(response.ok()).toBeTruthy();
    const body = await response.json() as { data: { records: unknown[] } };
    expect(body.data.records).toEqual([]);
  });
});
