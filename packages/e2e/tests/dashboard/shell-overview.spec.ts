/**
 * Global shell and overview.
 *
 * The redesign collapsed 11 pages into 6: 部署 / Agent / 运行时 became tabs on
 * the node detail panel, 衍生输出 folded into 总览, and 订阅状态 folded into 订阅.
 * The six retired paths are now redirects (see app.tsx), so they are asserted as
 * redirects instead of as pages. Sidebar entries mark the current page with an
 * `active` class rather than an inline background.
 */
import { expect, test } from '../../fixtures/e2e.js';

/** Every real page, keyed by its h1 — identical to PAGE_TITLES in navigation.ts. */
const pages = [
  ['/', '总览'],
  ['/nodes', '节点'],
  ['/subscription', '订阅'],
  ['/logs', '日志'],
  ['/config', '配置'],
  ['/api-docs', 'API'],
] as const;

/** Retired paths and the anchor each one lands on. */
const redirects = [
  ['/deploy', '/nodes', '节点'],
  ['/agents', '/nodes', '节点'],
  ['/runtimes', '/nodes', '节点'],
  ['/outputs', '/', '总览'],
  ['/subscription-status', '/subscription', '订阅'],
  ['/actions', '/subscription', '订阅'],
] as const;

test.describe('E00–E01 · 全局壳层与总览', () => {
  for (const [path, heading] of pages) {
    test(`直接访问 ${path} 可加载唯一功能页`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.locator('#main-content')).toBeVisible();
    });
  }

  for (const [path, target, heading] of redirects) {
    test(`${path} 兼容入口重定向到 ${target}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${target === '/' ? '/$' : `${target}$`}`));
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    });
  }

  test('桌面侧栏遍历全部 6 个唯一入口并标记当前页', async ({ page }) => {
    await page.goto('/');
    // 主区与系统区是两个 <nav>，链接总数覆盖两者。
    const navigation = page.locator('aside nav');
    await expect(navigation.getByRole('link')).toHaveCount(pages.length);

    for (const [path, heading] of pages) {
      // 「节点」入口带节点数徽章，可访问名是「节点 2」，所以不能要求 exact。
      const link = navigation.getByRole('link', { name: heading });
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/$' : `${path}$`}`));
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(link).toHaveClass(/active/);
    }
  });

  test('baseline 6 页没有浏览器 JS 异常或 console.error', async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
    page.on('console', message => {
      // 夹具会切断所有跨源请求（见 fixtures/e2e.ts），浏览器为此产生的
      // 资源加载错误来自隔离守卫本身，不是产品缺陷；真正的 JS 异常仍会被捕获。
      if (message.type() === 'error' && /ERR_BLOCKED_BY_CLIENT/.test(message.text())) return;
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    for (const [path, heading] of pages) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await page.waitForTimeout(100);
    }

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('主题切换写入持久化设置，刷新后保持', async ({ page }) => {
    await page.goto('/');
    // 桌面壳层的切换在侧栏底部，按钮文案即目标模式。
    await page.getByRole('button', { name: '深色模式', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: '浅色模式', exact: true })).toBeVisible();
  });

  test('总览 24h/7d/30d 指标窗口均命中真实路由', async ({ page, snapshot }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: '总览' })).toBeVisible();
    await page.getByRole('button', { name: '7d', exact: true }).click();
    await page.getByRole('button', { name: '30d', exact: true }).click();

    await expect.poll(async () => {
      const state = await snapshot();
      return state.requests.filter(request => request.path.startsWith('/api/metrics')).map(request => request.path);
    }).toEqual(expect.arrayContaining([
      expect.stringContaining('range=24h'),
      expect.stringContaining('range=7d'),
      expect.stringContaining('range=30d'),
    ]));
  });

  test('总览准确呈现就绪度、节点计数和三项正式产物', async ({ page }) => {
    await page.goto('/');
    // 侧栏常驻显示 mihomo 版本，就绪检查里也有一份，断言必须限定在主区。
    const main = page.locator('#main-content');

    await expect(main.getByText('1 个节点待部署', { exact: true })).toBeVisible();
    await expect(main.getByText('1/1 可用', { exact: true })).toBeVisible();
    await expect(main.getByText('v1.19.0-e2e', { exact: true })).toBeVisible();
    await expect(main.getByText('三个输出产物均可用', { exact: true })).toBeVisible();
    await expect(main.getByText('节点在线').locator('..')).toContainText('1/2');

    const artifacts = page.getByRole('table');
    for (const name of ['raw.txt', 'subscription.txt', 'clash.yaml']) {
      const row = artifacts.getByRole('row').filter({ hasText: name });
      await expect(row).toBeVisible();
      // 产物状态显示新鲜度而不是笼统的“可用”，缺失/无效必须缺席。
      await expect(row.getByText('无效/缺失', { exact: true })).toHaveCount(0);
      await expect(row.getByRole('link', { name: '下载' })).toBeVisible();
    }
  });

  test('总览页头导航只做上下文跳转，不产生写请求', async ({ page, snapshot }) => {
    const workflow = [
      ['添加节点', '/nodes', '节点'],
      ['生成订阅', '/subscription', '订阅'],
    ] as const;

    for (const [label, href, heading] of workflow) {
      await page.goto('/');
      const link = page.getByRole('link', { name: label, exact: true });
      await expect(link).toHaveAttribute('href', href);
      await link.click();
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      const current = new URL(page.url());
      expect(`${current.pathname}${current.search}`).toBe(href);
    }

    // /api/subscription-jobs/preflight 是只读探测，只因需要请求体才用 POST，
    // 不会改动任何状态，所以不算「写请求」。
    const readOnlyProbes = ['/api/subscription-jobs/preflight'];
    const state = await snapshot();
    expect(state.requests.filter(request =>
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
      && !readOnlyProbes.includes(request.path))).toEqual([]);
  });

  test('健康端点与 SPA fallback 保持服务边界', async ({ request }) => {
    const health = await request.get('/health');
    expect(health.ok()).toBeTruthy();
    expect(await health.json()).toMatchObject({ status: 'healthy' });

    const deepLink = await request.get('/nodes');
    expect(deepLink.ok()).toBeTruthy();
    expect(deepLink.headers()['content-type']).toContain('text/html');

    const missingApi = await request.get('/api/not-a-real-route');
    expect(missingApi.status()).toBe(404);
  });
});
