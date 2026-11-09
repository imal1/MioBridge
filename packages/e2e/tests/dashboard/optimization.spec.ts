import { test, expect } from '../../fixtures/e2e.js';

test('管理员登录建立 HttpOnly 会话；未登录 API 被拒绝', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:4173', extraHTTPHeaders: {} });
  try {
    expect((await context.request.get('/api/status')).status()).toBe(401);
    const page = await context.newPage(); await page.goto('/');
    await expect(page.getByRole('heading', { name: '登录 MioBridge' })).toBeVisible();
    await page.getByLabel('管理员令牌').fill('incorrect');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('登录令牌无效');
    await page.getByLabel('管理员令牌').fill('e'.repeat(64));
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '总览', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.cookie)).not.toContain('miobridge_session');
    expect((await context.request.get('/api/status')).status()).toBe(200);
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('heading', { name: '登录 MioBridge' })).toBeVisible();
  } finally { await context.close(); }
});

test('订阅分发使用公网地址并能生成二维码；重试输入允许第三个数', async ({ page, request }) => {
  const updated = await request.patch('/api/config', { data: { path: 'app.public_base_url', value: 'https://subscriptions.example' } });
  expect(updated.ok()).toBe(true);
  await page.goto('/subscription');
  await expect(page.getByLabel('Clash / mihomo订阅地址')).toHaveValue('https://subscriptions.example/clash.yaml');
  await page.getByRole('button', { name: '二维码', exact: true }).first().click();
  await expect(page.getByAltText('订阅地址二维码')).toBeVisible();
  const retry = page.getByLabel('重试间隔（分钟）');
  await retry.fill('1, 5,'); await expect(retry).toHaveValue('1, 5,');
  await retry.pressSequentially(' 15');
  await page.getByRole('button', { name: '保存策略', exact: true }).click();
  const policy = await (await request.get('/api/subscription-policy')).json();
  expect(policy.data.retryDelaysMinutes).toEqual([1, 5, 15]);
});
