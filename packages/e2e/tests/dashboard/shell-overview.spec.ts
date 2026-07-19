import { expect, test } from '../../fixtures/e2e.js';

const pages = [
  ['/', '总览'],
  ['/nodes', '节点'],
  ['/deploy', '部署中心'],
  ['/agents', 'Agent 维护'],
  ['/runtimes', '运行时'],
  ['/subscription', '订阅生成'],
  ['/outputs', '衍生输出'],
  ['/subscription-status', '订阅状态'],
  ['/logs', '日志'],
  ['/config', '配置'],
  ['/api-docs', 'API'],
] as const;

test.describe('E00–E01 · 全局壳层与总览', () => {
  for (const [path, heading] of pages) {
    test(`直接访问 ${path} 可加载唯一功能页`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.locator('#main-content')).toBeVisible();
    });
  }

  test('/actions 兼容入口重定向到订阅页', async ({ page }) => {
    await page.goto('/actions');
    await expect(page).toHaveURL(/\/subscription$/);
    await expect(page.getByRole('heading', { level: 1, name: '订阅生成' })).toBeVisible();
  });

  test('桌面侧栏遍历全部 11 个唯一入口并标记当前页', async ({ page }) => {
    await page.goto('/');
    const navigation = page.locator('aside nav');
    await expect(navigation.getByRole('link')).toHaveCount(11);

    for (const [path, heading] of pages) {
      const label = path === '/' ? '总览'
        : path === '/deploy' ? '部署中心'
          : path === '/agents' ? 'Agent 维护'
            : path === '/outputs' ? '衍生输出'
              : path === '/subscription-status' ? '订阅状态'
                : path === '/api-docs' ? 'API'
                  : heading.replace('生成', '').replace('中心', '');
      const link = navigation.getByRole('link', { name: label, exact: true });
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/$' : `${path}$`}`));
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      expect(await link.evaluate(element => element.style.background)).toBe('var(--sidebar-accent)');
    }
  });

  test('baseline 11 页没有浏览器 JS 异常或 console.error', async ({ page }) => {
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
    const toggle = page.getByRole('button', { name: '切换到夜间模式' });
    await toggle.click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: '切换到日间模式' })).toBeVisible();
  });

  test('总览刷新和 24h/7d/30d 指标窗口均命中真实路由', async ({ page, snapshot }) => {
    await page.goto('/');
    await expect(page.getByText('从节点到可用订阅')).toBeVisible();
    await page.getByRole('button', { name: '7d' }).click();
    await page.getByRole('button', { name: '30d' }).click();
    await page.getByRole('button', { name: '刷新摘要' }).click();

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

    await expect(page.getByText('1 个节点待部署', { exact: true })).toBeVisible();
    await expect(page.getByText('1/1 可用', { exact: true })).toBeVisible();
    await expect(page.getByText('v1.19.0-e2e', { exact: true })).toBeVisible();
    await expect(page.getByText('输出产物可用', { exact: true })).toBeVisible();
    await expect(page.getByText('子节点在线').locator('..')).toContainText('1/2');

    const artifacts = page.getByRole('table');
    for (const name of ['raw.txt', 'subscription.txt', 'clash.yaml']) {
      const row = artifacts.getByRole('row').filter({ hasText: name });
      await expect(row).toBeVisible();
      await expect(row.getByText('可用', { exact: true })).toBeVisible();
    }
  });

  test('总览四步导航只做上下文跳转，不产生写请求', async ({ page, snapshot }) => {
    // '添加节点' 落地即打开添加节点对话框，模态框会把页面内容标记为 aria-hidden，
    // 此时页面 h1 不在无障碍树里，只能断言对话框本身。
    const workflow = [
      ['添加节点', '/nodes?intent=add', 'dialog', '添加节点'],
      ['部署运行环境', '/deploy', 'heading', '部署中心'],
      ['生成订阅', '/subscription', 'heading', '订阅生成'],
      ['维护订阅状态', '/subscription-status', 'heading', '订阅状态'],
    ] as const;

    for (const [label, href, landmark, name] of workflow) {
      await page.goto('/');
      const link = page.getByRole('link', { name: label, exact: true });
      await expect(link).toHaveAttribute('href', href);
      await link.click();
      await expect(landmark === 'dialog'
        ? page.getByRole('dialog', { name })
        : page.getByRole('heading', { level: 1, name })).toBeVisible();
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
