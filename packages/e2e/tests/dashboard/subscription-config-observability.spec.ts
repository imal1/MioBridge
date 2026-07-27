import type { Download, Locator, Page, Route } from '@playwright/test';
import { expect, test, type HarnessSnapshot } from '../../fixtures/e2e.js';

function requests(
  state: HarnessSnapshot,
  method: string,
  path: string,
) {
  return state.requests.filter(request => request.method === method && request.path.startsWith(path));
}

function exactRequests(state: HarnessSnapshot, method: string, path: string) {
  return state.requests.filter(request => request.method === method && request.path.split('?')[0] === path);
}

function recordId(records: readonly Record<string, unknown>[] | undefined, key: string): string | undefined {
  const value = records?.[0]?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** Windows 剪贴板会把 \n 写成 \r\n，比对多行文本前先归一化。 */
async function clipboardText(page: Page): Promise<string> {
  const value = await page.evaluate(() => navigator.clipboard.readText());
  return value.replace(/\r\n/gu, '\n');
}

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  let result = '';
  for await (const chunk of stream) result += chunk.toString();
  return result;
}

async function grantClipboard(page: Page): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
}

/** 产物从独立的 /outputs 页并入总览，现在是「输出产物」表格的一行。 */
function artifactRow(page: Page, name: 'raw.txt' | 'subscription.txt' | 'clash.yaml'): Locator {
  return page.locator('tbody tr').filter({ hasText: `/${name}` });
}

/** 健康检查的每一项是「标签 + 明细」两行，断言明细时要限定在同一格内。 */
function healthCheck(page: Page, label: string): Locator {
  return page.locator('div').filter({ has: page.getByText(label, { exact: true }) }).last();
}

/** 任务历史的一行；订阅任务节点数是行内唯一的稳定标识。 */
function jobRow(page: Page, text: string): Locator {
  return page.locator('tbody tr').filter({ hasText: text }).first();
}

function sensitiveKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) sensitiveKeys(item, found);
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(secret|password|privateKey|credentialRef)$/i.test(key)) found.push(key);
    sensitiveKeys(child, found);
  }
  return found;
}

test.describe('E10 · 订阅预检与正式生成', () => {
  test('预检通过后创建持久化任务，携带幂等键并进入任务历史', async ({ page, snapshot }) => {
    const jobsBefore = (await snapshot()).subscriptionJobs?.length ?? 0;
    await page.goto('/subscription');
    await expect(page.getByRole('heading', { level: 1, name: '订阅' })).toBeVisible();
    await expect(page.getByText('生成前检查通过')).toBeVisible();

    const created = page.waitForResponse(response =>
      response.url().endsWith('/api/subscription-jobs') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '创建生成任务' }).click();
    expect((await created).status()).toBe(202);
    await expect(page.getByText('订阅任务已持久化并进入队列')).toBeVisible();

    await expect.poll(async () => (await snapshot()).subscriptionJobs?.length ?? 0).toBeGreaterThan(jobsBefore);
    const state = await snapshot();
    const request = exactRequests(state, 'POST', '/api/subscription-jobs').at(-1);
    expect(request?.headers?.['idempotency-key']).toBeTruthy();
    await expect(page.getByText('任务历史', { exact: true })).toBeVisible();
  });

  test('零可读来源会阻断生成，轮询预检不会创建任务', async ({ page, control, snapshot }) => {
    await control({ subscriptionReady: false });
    await page.goto('/subscription');
    await expect(page.getByText('生成被阻断')).toBeVisible();
    // 创建入口在被阻断时会把原因写进按钮标签，所以这里按当前状态的标签定位。
    await expect(page.getByRole('button', { name: '预检未通过' })).toBeDisabled();

    // 预检不再是手动按钮，页面每 5s 轮询一次；重复预检既不能解除阻断，也不能创建任务。
    await expect.poll(
      async () => exactRequests(await snapshot(), 'POST', '/api/subscription-jobs/preflight').length,
      { timeout: 15_000 },
    ).toBeGreaterThanOrEqual(2);
    await expect(page.getByText('生成被阻断')).toBeVisible();
    expect(exactRequests(await snapshot(), 'POST', '/api/subscription-jobs')).toEqual([]);
  });

  test('预检请求失败时创建入口保持禁用', async ({ page, control }) => {
    await control({ subscriptionPreflightFailure: true });
    const preflight = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/subscription-jobs/preflight'
      && response.request().method() === 'POST');
    await page.goto('/subscription');
    expect((await preflight).status()).toBe(503);
    await expect(page.getByRole('button', { name: '预检失败' })).toBeDisabled();
  });

  // 已知缺口：预检失败时页面既不显示预检横幅也不显示错误横幅，只留一个禁用按钮，
  // 用户无从判断是「没有来源」还是「服务端挂了」。修好后本用例会「非预期通过」，
  // 那时删掉 test.fail() 即可。断言给短超时，避免变成用例超时（超时不算预期内失败）。
  test('预检请求失败应说明原因', async ({ page, control }) => {
    test.fail();
    await control({ subscriptionPreflightFailure: true });
    await page.goto('/subscription');
    await expect(page.getByText('fixture subscription preflight failure').first()).toBeVisible({ timeout: 3_000 });
  });

  test('预检通过后创建请求失败会保留历史且明确告警', async ({ page, control, snapshot }) => {
    await control({ subscriptionStartFailure: true });
    const before = (await snapshot()).subscriptionJobs?.length ?? 0;
    await page.goto('/subscription');
    await expect(page.getByText('生成前检查通过')).toBeVisible();

    const created = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/subscription-jobs'
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: '创建生成任务' }).click();
    expect((await created).status()).toBe(503);
    await expect(page.getByText('订阅任务失败')).toBeVisible();
    // 页内告警与 toast 会同时呈现同一条服务端原因，取首个即可。
    await expect(page.getByText('fixture subscription start failure').first()).toBeVisible();
    await expect(page.getByText('订阅生成未启动')).toBeVisible();
    expect((await snapshot()).subscriptionJobs?.length ?? 0).toBe(before);
  });

  test('SSE payload 按顺序报告排队、转换和完成步骤，页面同步来源数', async ({ page }) => {
    await page.goto('/subscription');
    const created = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/subscription-jobs'
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: '创建生成任务' }).click();
    const body = await (await created).json() as { data: { jobId: string } };

    const events = await page.evaluate(async eventUrl => new Promise<Array<{
      eventId: string;
      eventType: string;
      data: Record<string, unknown>;
    }>>((resolve, reject) => {
      const stream = new EventSource(eventUrl);
      const received: Array<{ eventId: string; eventType: string; data: Record<string, unknown> }> = [];
      const timer = window.setTimeout(() => {
        stream.close();
        reject(new Error('subscription SSE timed out'));
      }, 4_000);
      stream.addEventListener('progress', rawEvent => {
        const event = rawEvent as MessageEvent<string>;
        const data = JSON.parse(event.data) as Record<string, unknown>;
        received.push({ eventId: event.lastEventId, eventType: event.type, data });
        if (['succeeded', 'partial', 'failed'].includes(String(data.status))) {
          window.clearTimeout(timer);
          stream.close();
          resolve(received);
        }
      });
      stream.onerror = () => {
        window.clearTimeout(timer);
        stream.close();
        reject(new Error('subscription SSE disconnected before a terminal event'));
      };
    }), `/api/subscription-jobs/${encodeURIComponent(body.data.jobId)}/events`);

    // 正式管线是 采集 → 解析 → 去重 → 编码 → 转换 → 验证 → 发布 → 备份 → 完成，
    // 每一步都单独上报一次 progress，事件号为 8 位零填充且严格递增。
    expect(new Set(events.map(event => event.eventType))).toEqual(new Set(['progress']));
    expect(events.map(event => event.eventId))
      .toEqual(events.map((_, index) => String(index + 1).padStart(8, '0')));
    expect(events.map(event => event.data.step)).toEqual([
      'collect', 'collect', 'parse', 'deduplicate', 'encode', 'convert', 'validate', 'publish', 'backup', 'done',
    ]);
    expect(events.map(event => event.data.status)).toEqual([
      'queued', ...Array<string>(8).fill('running'), 'succeeded',
    ]);
    for (const event of events) {
      expect(event.data).toMatchObject({
        eventId: event.eventId,
        jobId: body.data.jobId,
        progress: expect.any(Number),
        message: expect.any(String),
        timestamp: expect.any(String),
      });
    }
    const row = jobRow(page, '4 个节点');
    await expect(row).toContainText('来源 3/3');
    await expect(row).toContainText('完成 · 订阅生成完成');
  });

  test('已有活动任务时禁用重复创建并建立 SSE 进度连接', async ({ page, control, snapshot }) => {
    await control({ subscriptionJobStatus: 'running' });
    await page.goto('/subscription');
    await expect(page.getByRole('button', { name: '生成任务执行中' })).toBeDisabled();

    await expect.poll(async () => {
      const state = await snapshot();
      return state.requests.some(request => request.method === 'GET' && /\/api\/subscription-jobs\/[^/]+\/events/.test(request.path));
    }).toBeTruthy();
    expect(exactRequests(await snapshot(), 'POST', '/api/subscription-jobs')).toEqual([]);
  });

  test('SSE 连接中断必须进入可恢复的明确错误态', async ({ page, control }) => {
    await control({ subscriptionJobStatus: 'running' });
    await page.route(/\/api\/subscription-jobs\/[^/]+\/events$/, route => route.abort('connectionfailed'));
    await page.goto('/subscription');
    await expect(page.getByText('进度连接中断；任务仍在服务端执行。')).toBeVisible();
    await expect(page.getByRole('button', { name: '重新连接' })).toBeVisible();
  });
});

test.describe('E11 · 订阅历史、恢复与重试', () => {
  test('成功任务在刷新后恢复，并提供任务日志入口', async ({ page, control }) => {
    await control({ subscriptionJobStatus: 'succeeded' });
    await page.goto('/subscription');
    await expect(page.getByText('成功', { exact: true })).toBeVisible();
    await page.reload();
    const row = jobRow(page, '4 个节点');
    await expect(row.getByText('成功', { exact: true })).toBeVisible();
    await expect(row.getByRole('link', { name: '日志' }))
      .toHaveAttribute('href', /^\/logs\?source=subscription&task=/);
  });

  test('失败任务可按原输入创建重试任务', async ({ page, control, snapshot }) => {
    await control({ subscriptionJobStatus: 'failed' });
    await page.goto('/subscription');
    await expect(page.getByText('失败', { exact: true })).toBeVisible();
    const retried = page.waitForResponse(response =>
      /\/api\/subscription-jobs\/[^/]+\/retry$/.test(new URL(response.url()).pathname)
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: '重试' }).click();
    expect((await retried).status()).toBe(202);
    await expect(page.getByText('已按上次输入创建重试任务')).toBeVisible();
    expect((await snapshot()).subscriptionJobs?.length).toBeGreaterThanOrEqual(2);
  });

  test('部分成功任务恢复来源统计与警告', async ({ page, control, request }) => {
    await control({ subscriptionJobStatus: 'partial' });
    await page.goto('/subscription');
    const row = jobRow(page, '4 个节点');
    await expect(row.getByText('部分成功', { exact: true })).toBeVisible();
    await expect(row).toContainText('来源 2/3');
    await expect(row).toContainText('完成 · 部分来源失败');

    // 任务历史行不展示 warnings，但持久化的任务必须保留，否则「部分成功」无从诊断。
    const jobs = await (await request.get('/api/subscription-jobs')).json() as {
      data: { jobs: Array<{ status: string; warnings: string[] }> };
    };
    expect(jobs.data.jobs[0]).toMatchObject({ status: 'partial', warnings: ['一个远端来源不可用'] });
  });

  test('重试请求失败应保留原任务并显示可操作错误', async ({ page, control, snapshot }) => {
    await control({ subscriptionJobStatus: 'failed', subscriptionRetryFailure: true });
    const before = (await snapshot()).subscriptionJobs?.length ?? 0;
    await page.goto('/subscription');
    const retried = page.waitForResponse(response =>
      /\/api\/subscription-jobs\/[^/]+\/retry$/.test(new URL(response.url()).pathname)
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: '重试' }).click();
    expect((await retried).status()).toBe(503);
    await expect(page.getByText('任务重试失败')).toBeVisible();
    await expect(page.getByRole('button', { name: '重试' })).toBeEnabled();
    expect((await snapshot()).subscriptionJobs?.length ?? 0).toBe(before);
  });

  test('部分成功任务也应提供按原输入重试', async ({ page, control }) => {
    await control({ subscriptionJobStatus: 'partial' });
    await page.goto('/subscription');
    await expect(page.getByText('部分成功', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible();
  });
});

test.describe('E12 · 正式产物', () => {
  test('三个正式产物可验证、预览、复制 URL 和下载', async ({ page, request }) => {
    await grantClipboard(page);
    await page.goto('/');
    await expect(page.getByText('原始链接', { exact: true })).toBeVisible();
    await expect(page.getByText('Base64 订阅', { exact: true })).toBeVisible();
    await expect(page.getByText('Clash 配置', { exact: true })).toBeVisible();

    const validated = page.waitForResponse(response =>
      response.url().endsWith('/api/artifacts/validate') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '验证全部' }).click();
    expect((await validated).ok()).toBeTruthy();
    await expect(page.getByText('三个正式产物均通过验证')).toBeVisible();

    const cases = [
      { name: 'raw.txt', contentType: 'text/plain' },
      { name: 'subscription.txt', contentType: 'text/plain' },
      { name: 'clash.yaml', contentType: 'yaml' },
    ] as const;
    for (const item of cases) {
      const row = artifactRow(page, item.name);
      await expect(row).toHaveCount(1);
      const publicResponse = await request.get(`/${item.name}`);
      expect(publicResponse.ok()).toBeTruthy();
      expect(publicResponse.headers()['content-type']).toContain(item.contentType);
      const expectedContent = await publicResponse.text();

      await row.getByRole('button', { name: '复制 URL', exact: true }).click();
      expect(await clipboardText(page)).toBe(new URL(`/${item.name}`, page.url()).toString());

      await row.getByRole('button', { name: '预览', exact: true }).click();
      const preview = page.getByRole('dialog');
      await expect(preview.getByRole('heading', { name: `${item.name} 预览` })).toBeVisible();
      await expect(preview.locator('pre')).toHaveText(expectedContent);
      await page.keyboard.press('Escape');
      await expect(preview).toBeHidden();

      const downloadPromise = page.waitForEvent('download');
      await row.getByRole('link', { name: '下载', exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(item.name);
      expect(await downloadText(download)).toBe(expectedContent);
    }
  });

  test('产物缺失时禁用分发动作', async ({ page, control }) => {
    await control({ artifactsMissing: true });
    await page.goto('/');
    await expect(page.getByText('无效/缺失')).toHaveCount(3);
    for (const name of ['raw.txt', 'subscription.txt', 'clash.yaml'] as const) {
      const row = artifactRow(page, name);
      await expect(row.getByRole('button', { name: '复制 URL', exact: true })).toBeDisabled();
      await expect(row.getByRole('button', { name: '预览', exact: true })).toBeDisabled();
      // 下载是 <a download>，禁用只能靠去掉 href；没有 href 的 <a> 连 link role 都不是，
      // 所以用文本定位，顺带证明它已经不可点。
      await expect(row.locator('a').filter({ hasText: '下载' })).not.toHaveAttribute('href', /./);
    }
    await expect(page.getByText('产物待生成')).toBeVisible();
  });

  test('无效产物显示验证错误，过期产物显示 stale 状态且均保留诊断动作', async ({ page, control }) => {
    await control({ artifactInvalid: 'raw.txt', artifactStale: 'clash.yaml' });
    await page.goto('/');
    const invalid = artifactRow(page, 'raw.txt');
    const stale = artifactRow(page, 'clash.yaml');

    await expect(invalid.getByText('无效/缺失', { exact: true })).toBeVisible();
    await expect(invalid.getByRole('button', { name: '预览', exact: true })).toBeEnabled();
    await expect(stale.getByText('已过期', { exact: true })).toBeVisible();
    await expect(stale.getByRole('link', { name: '下载', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '验证全部' }).click();
    await expect(page.getByText('1 个产物未通过验证')).toBeVisible();
  });

  test('验证接口 success:false 时不得报告全部产物通过', async ({ page }) => {
    await page.route('**/api/artifacts/validate', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        error: { code: 'ARTIFACT_VALIDATION_FAILED', message: 'fixture validation failure', retryable: true },
        requestId: 'outputs-validation-failure',
        role: 'admin',
        timestamp: new Date().toISOString(),
      }),
    }), { times: 1 });
    await page.goto('/');
    await page.getByRole('button', { name: '验证全部' }).click();
    await expect(page.getByRole('button', { name: '验证全部' })).toBeEnabled();
    await expect(page.getByText('三个正式产物均通过验证')).toHaveCount(0);
  });
});

test.describe('E13 · 临时转换', () => {
  test('空输入不可提交；有效输入可复制、清空且不修改正式产物', async ({ page, request, snapshot }) => {
    const before = await (await request.get('/raw.txt')).text();
    await grantClipboard(page);
    await page.goto('/');
    await page.getByRole('button', { name: '打开临时转换器' }).click();
    const dialog = page.getByRole('dialog');
    const convert = dialog.getByRole('button', { name: '转换', exact: true });
    await expect(convert).toBeDisabled();

    await dialog.getByLabel('原始订阅文本').fill(
      'vless://11111111-1111-4111-8111-111111111111@example.invalid:443?security=tls#E2E',
    );
    const converted = page.waitForResponse(response =>
      response.url().endsWith('/api/convert') && response.request().method() === 'POST');
    await convert.click();
    expect((await converted).ok()).toBeTruthy();
    const copy = dialog.getByRole('button', { name: '复制', exact: true });
    await expect(copy).toBeEnabled();
    await copy.click();
    expect(await clipboardText(page)).toContain('proxies');

    const clearButtons = dialog.getByRole('button', { name: '清空', exact: true });
    await clearButtons.last().click();
    await expect(copy).toBeDisabled();
    await clearButtons.first().click();
    await expect(convert).toBeDisabled();

    expect(await (await request.get('/raw.txt')).text()).toBe(before);
    const state = await snapshot();
    expect(requests(state, 'POST', '/api/convert')).toHaveLength(1);
    expect(requests(state, 'POST', '/api/artifacts/validate')).toEqual([]);
  });

  test('转换器失败时在对话框内显示错误且不产生正式任务', async ({ page, control, snapshot }) => {
    await control({ conversionFailure: true });
    await page.goto('/');
    await page.getByRole('button', { name: '打开临时转换器' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('原始订阅文本').fill('vless://invalid.example');
    await dialog.getByRole('button', { name: '转换', exact: true }).click();
    await expect(dialog).toContainText(/转换失败|API Error/);
    expect(exactRequests(await snapshot(), 'POST', '/api/subscription-jobs')).toEqual([]);
  });

  test('关闭或 Escape 退出转换对话框后清除临时草稿', async ({ page }) => {
    await page.goto('/');
    const open = page.getByRole('button', { name: '打开临时转换器' });
    const input = page.getByLabel('原始订阅文本');

    await open.click();
    await input.fill('vless://temporary-close.example');
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await open.click();
    await expect(input).toHaveValue('');

    await input.fill('vless://temporary-escape.example');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await open.click();
    await expect(input).toHaveValue('');
    await expect(page.getByRole('dialog').getByRole('button', { name: '转换', exact: true })).toBeDisabled();
  });
});

test.describe('E14 · 订阅健康与策略', () => {
  test('健康检查覆盖产物、转换器与公共 URL，策略以单次 PUT 保存', async ({ page, snapshot }) => {
    await page.goto('/subscription');
    await expect(page.getByRole('heading', { name: '健康检查', exact: true })).toBeVisible();
    for (const label of ['raw.txt', 'subscription.txt', 'clash.yaml', 'mihomo 转换器', '公共兼容 URL', '节点突降阈值']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    const cron = page.getByLabel('Cron');
    await expect(cron).toBeEnabled();
    await page.getByRole('button', { name: '启用定时生成' }).click();
    await page.getByLabel('新鲜度目标（小时）').fill('12');
    await page.getByLabel('节点突降阈值（%）').fill('25');
    const saved = page.waitForResponse(response =>
      response.url().endsWith('/api/subscription-policy') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: '保存策略' }).click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page.getByText('定时生成策略已保存')).toBeVisible();

    const writes = requests(await snapshot(), 'PUT', '/api/subscription-policy');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toMatchObject({ enabled: true, freshnessHours: 12, nodeDropPercent: 25 });
  });

  test('数值下界与上界可保存，越界时服务端拒绝并保留草稿', async ({ page, snapshot }) => {
    await page.goto('/subscription');
    const freshness = page.getByLabel('新鲜度目标（小时）');
    const nodeDrop = page.getByLabel('节点突降阈值（%）');
    const save = page.getByRole('button', { name: '保存策略' });
    const saveStatus = async () => {
      const response = page.waitForResponse(item =>
        new URL(item.url()).pathname === '/api/subscription-policy'
        && item.request().method() === 'PUT');
      await save.click();
      return (await response).status();
    };

    await expect(freshness).toHaveValue('24');
    await expect(nodeDrop).toHaveValue('30');

    await freshness.fill('1');
    await nodeDrop.fill('0');
    expect(await saveStatus()).toBe(200);
    await expect(page.getByText('定时生成策略已保存')).toBeVisible();

    await nodeDrop.fill('100');
    expect(await saveStatus()).toBe(200);

    await freshness.fill('0');
    expect(await saveStatus()).toBe(422);
    await expect(page.getByText('订阅任务失败')).toBeVisible();
    await expect(freshness).toHaveValue('0');
    await expect(nodeDrop).toHaveValue('100');

    await freshness.fill('1');
    await nodeDrop.fill('-1');
    expect(await saveStatus()).toBe(422);
    await expect(nodeDrop).toHaveValue('-1');

    await nodeDrop.fill('101');
    expect(await saveStatus()).toBe(422);
    await expect(nodeDrop).toHaveValue('101');
    await expect(save).toBeEnabled();

    const writes = exactRequests(await snapshot(), 'PUT', '/api/subscription-policy');
    expect(writes.map(request => request.body)).toEqual([
      expect.objectContaining({ freshnessHours: 1, nodeDropPercent: 0 }),
      expect.objectContaining({ freshnessHours: 1, nodeDropPercent: 100 }),
      expect.objectContaining({ freshnessHours: 0, nodeDropPercent: 100 }),
      expect.objectContaining({ freshnessHours: 1, nodeDropPercent: -1 }),
      expect.objectContaining({ freshnessHours: 1, nodeDropPercent: 101 }),
    ]);
    expect((await snapshot()).policy).toMatchObject({ freshnessHours: 1, nodeDropPercent: 100 });
  });

  test('策略未加载完成前不得接受输入，加载后草稿不被覆盖', async ({ page, snapshot }) => {
    // 把策略 GET 拖到用户开始输入之后才返回，复现「抢先输入被静默吞掉」。
    let releasePolicy = () => {};
    const policyLoaded = new Promise<void>(resolve => { releasePolicy = resolve; });
    await page.route('**/api/subscription-policy', async route => {
      if (route.request().method() !== 'GET') return route.continue();
      await policyLoaded;
      return route.continue();
    });

    await page.goto('/subscription');
    const freshness = page.getByLabel('新鲜度目标（小时）');
    // policy 为 null 时 onChange 会整条丢弃输入，所以控件必须先禁用而不是假装可编辑。
    await expect(freshness).toBeDisabled();
    releasePolicy();

    await expect(freshness).toBeEnabled();
    await freshness.fill('7');
    const saved = page.waitForResponse(item =>
      new URL(item.url()).pathname === '/api/subscription-policy'
      && item.request().method() === 'PUT');
    await page.getByRole('button', { name: '保存策略' }).click();
    expect((await saved).ok()).toBeTruthy();
    await expect(freshness).toHaveValue('7');
    expect((await snapshot()).policy).toMatchObject({ freshnessHours: 7 });
  });

  test('策略保存失败可见，保留草稿与原策略', async ({ page, control, snapshot }) => {
    await control({ policyInvalid: true });
    const original = (await snapshot()).policy;
    await page.goto('/subscription');
    const cron = page.getByLabel('Cron');
    const freshness = page.getByLabel('新鲜度目标（小时）');
    await expect(cron).toBeEnabled();
    await cron.fill('*/15 * * * *');
    await freshness.fill('12');
    await page.getByRole('button', { name: '保存策略' }).click();
    await expect(page.getByText('订阅任务失败')).toBeVisible();
    await expect(cron).toHaveValue('*/15 * * * *');
    await expect(freshness).toHaveValue('12');
    await expect(page.getByRole('button', { name: '保存策略' })).toBeEnabled();
    expect((await snapshot()).policy).toEqual(original);
    expect(exactRequests(await snapshot(), 'PUT', '/api/subscription-policy')).toHaveLength(1);
  });

  test('公共兼容 URL 检查与三个真实产物一致', async ({ page, request }) => {
    await page.goto('/subscription');
    const check = healthCheck(page, '公共兼容 URL');
    await expect(check).toContainText('/raw.txt · /subscription.txt · /clash.yaml');
    // 检查项由 /api/artifacts 汇总，所以三个公共 URL 必须真的可读，否则「通过」是假的。
    for (const path of ['/raw.txt', '/subscription.txt', '/clash.yaml']) {
      const response = await request.get(path);
      expect(response.ok(), path).toBeTruthy();
      expect((await response.text()).length, path).toBeGreaterThan(0);
    }
  });

  test('节点突降检查必须由任务历史计算而非硬编码通过', async ({ page }) => {
    const current = new Date('2026-07-16T12:00:00.000Z');
    const previous = new Date('2026-07-16T06:00:00.000Z');
    await page.route(url => new URL(url).pathname === '/api/subscription-jobs', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          jobs: [
            { id: 'job-current', status: 'succeeded', step: 'done', progress: 100, message: 'done', sourcesTotal: 1, sourcesSucceeded: 1, nodesGenerated: 1, warnings: [], errors: [], createdAt: current.toISOString(), finishedAt: current.toISOString() },
            { id: 'job-previous', status: 'succeeded', step: 'done', progress: 100, message: 'done', sourcesTotal: 1, sourcesSucceeded: 1, nodesGenerated: 100, warnings: [], errors: [], createdAt: previous.toISOString(), finishedAt: previous.toISOString() },
          ],
        },
        timestamp: current.toISOString(),
      }),
    }));
    await page.goto('/subscription');
    // 100 → 1 是 99% 跌幅，远超 30% 阈值；明细必须复述真实对比而不是一句「通过」。
    await expect(healthCheck(page, '节点突降阈值')).toContainText('较上次 100 → 1，阈值 30%');
  });

  test('失败重试间隔可编辑并随策略原子保存', async ({ page, snapshot }) => {
    await page.goto('/subscription');
    const retryField = page.getByLabel('重试间隔（分钟）');
    await expect(retryField).toBeEnabled();
    await retryField.fill('2, 8, 30');
    await page.getByRole('button', { name: '保存策略' }).click();
    await expect.poll(async () => {
      const writes = exactRequests(await snapshot(), 'PUT', '/api/subscription-policy');
      return writes.at(-1)?.body;
    }).toMatchObject({ retryDelaysMinutes: [2, 8, 30] });
  });
});

test.describe('E15 · 四来源日志', () => {
  test('控制面、Agent、部署和订阅日志均按完整过滤参数请求', async ({ page, request, snapshot, control }) => {
    await control({ subscriptionJobStatus: 'failed' });
    let state = await snapshot();
    const nodeId = recordId(state.nodes, 'nodeId') ?? recordId(state.nodes, 'id');
    expect(nodeId).toBeTruthy();

    const deployment = await request.post('/api/deployments', {
      headers: { 'Idempotency-Key': 'logs-deployment' },
      data: { nodeId, component: 'agent', operation: 'install', options: { preserveConfig: true, preserveData: true } },
    });
    expect(deployment.status()).toBe(202);
    const deploymentId = (await deployment.json() as { data: { taskId: string } }).data.taskId;
    state = await snapshot();
    const subscriptionId = recordId(state.subscriptionJobs, 'id');
    expect(subscriptionId).toBeTruthy();

    await page.goto('/logs');
    await expect(page.getByRole('heading', { level: 1, name: '日志' })).toBeVisible();
    await expect(page.getByText(/控制面 · .* 行/).first()).toBeVisible();
    const applyFilters = async () => {
      const response = page.waitForResponse(item =>
        new URL(item.url()).pathname === '/api/logs'
        && item.request().method() === 'GET');
      await page.getByRole('button', { name: '应用过滤' }).click();
      expect((await response).ok()).toBeTruthy();
    };

    await page.getByLabel('日志来源').selectOption('agent');
    await page.getByLabel('节点', { exact: true }).selectOption(nodeId!);
    await page.getByLabel('组件').selectOption('agent');
    await page.getByLabel('日志级别').selectOption('info');
    await page.getByLabel('关键词').fill('fixture');
    await applyFilters();

    await page.getByLabel('日志来源').selectOption('deployment');
    await page.getByLabel('任务 ID').fill(deploymentId);
    await applyFilters();

    await page.getByLabel('日志来源').selectOption('subscription');
    await page.getByLabel('任务 ID').fill(subscriptionId!);
    await applyFilters();

    const paths = (await snapshot()).requests.filter(item => item.method === 'GET' && item.path.startsWith('/api/logs')).map(item => item.path);
    const queries = paths.map(path => new URL(path, 'http://e2e.invalid').searchParams);
    expect(queries.some(query => query.get('source') === 'control')).toBeTruthy();
    expect(queries.some(query => query.get('source') === 'agent' && query.get('node') === nodeId)).toBeTruthy();
    expect(queries.some(query => query.get('source') === 'deployment' && query.get('taskId') === deploymentId)).toBeTruthy();
    expect(queries.some(query => query.get('source') === 'subscription' && query.get('taskId') === subscriptionId)).toBeTruthy();
    expect(queries.some(query => query.get('component') === 'agent' && query.get('level') === 'info' && query.get('q') === 'fixture')).toBeTruthy();
  });

  test('缺少必填上下文时就地报错；复制、导出与自动刷新保持完整内容', async ({ page, snapshot }) => {
    await grantClipboard(page);
    await page.goto('/logs');
    await expect(page.getByText(/控制面 · .* 行/).first()).toBeVisible();
    const requestsBeforeInvalid = exactRequests(await snapshot(), 'GET', '/api/logs').length;

    await page.getByLabel('日志来源').selectOption('deployment');
    await page.getByLabel('任务 ID').fill('');
    await page.getByRole('button', { name: '应用过滤' }).click();
    await expect(page.getByText('部署任务日志需要任务 ID')).toBeVisible();

    await page.getByLabel('日志来源').selectOption('subscription');
    await page.getByLabel('任务 ID').fill('');
    await page.getByRole('button', { name: '应用过滤' }).click();
    await expect(page.getByText('订阅任务日志需要任务 ID')).toBeVisible();
    expect(exactRequests(await snapshot(), 'GET', '/api/logs')).toHaveLength(requestsBeforeInvalid);

    await page.getByLabel('日志来源').selectOption('control');
    const controlLogs = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/logs'
      && response.request().method() === 'GET');
    await page.getByRole('button', { name: '应用过滤' }).click();
    expect((await controlLogs).ok()).toBeTruthy();
    // 日志正文现在是 pre.signal-mono，不再有 .signal-terminal 这层皮。
    // 用 textContent 而不是 innerText：复制与导出写的是原始 lines.join('\n')，
    // innerText 会按渲染结果改写换行，两边就永远对不上。
    const terminal = page.locator('#main-content pre');
    const terminalText = (await terminal.textContent()) ?? '';
    expect(terminalText).toContain('fixture control ready');
    expect(terminalText).toContain('fixture diagnostic marker');

    await page.getByRole('button', { name: '复制', exact: true }).click();
    expect(await clipboardText(page)).toBe(terminalText);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('control');
    expect(await downloadText(download)).toBe(terminalText);

    const refreshed = page.waitForRequest(request => new URL(request.url()).pathname === '/api/logs');
    await page.getByRole('button', { name: '自动刷新' }).click();
    await refreshed;
    await page.getByRole('button', { name: '暂停' }).click();
  });

  test('没有节点时 Agent 日志就地报错而不发请求', async ({ page, snapshot }) => {
    // 有节点时页面会自动选中第一个，「未选节点」只在集群为空时可达。
    await page.route(url => new URL(url).pathname === '/api/cluster/status', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { totalNodes: 0, onlineNodes: 0, totalProxies: 0, nodes: [] },
        timestamp: new Date().toISOString(),
      }),
    }));
    await page.goto('/logs');
    await expect(page.getByText(/控制面 · .* 行/).first()).toBeVisible();
    const before = exactRequests(await snapshot(), 'GET', '/api/logs').length;

    await page.getByLabel('日志来源').selectOption('agent');
    await page.getByRole('button', { name: '应用过滤' }).click();
    await expect(page.getByText('Agent 日志需要先选择一个节点')).toBeVisible();
    expect(exactRequests(await snapshot(), 'GET', '/api/logs')).toHaveLength(before);
  });

  test('日志请求失败显示统一错误态并保留上一次成功结果', async ({ page, control }) => {
    await page.goto('/logs');
    await expect(page.getByText(/控制面 · .* 行/).first()).toBeVisible();
    const terminal = page.locator('#main-content pre');
    const previous = await terminal.textContent();
    expect(previous).toContain('fixture control ready');

    await control({ logFailure: true });
    const failed = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/logs'
      && response.request().method() === 'GET');
    await page.getByRole('button', { name: '应用过滤' }).click();
    expect((await failed).ok()).toBeFalsy();
    await expect(page.getByText('日志读取失败')).toBeVisible();
    expect(await terminal.textContent()).toBe(previous);
    await expect(page.getByRole('button', { name: '复制', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '导出', exact: true })).toBeEnabled();
  });

  test('订阅任务的日志链接应保留 subscription 来源上下文', async ({ page, control }) => {
    await control({ subscriptionJobStatus: 'failed' });
    await page.goto('/subscription');
    await jobRow(page, '0 个节点').getByRole('link', { name: '日志' }).click();
    await expect(page).toHaveURL(/source=subscription/);
    await expect(page.getByLabel('日志来源')).toHaveValue('subscription');
  });
});

test.describe('E16 · Schema 配置草稿与原子保存', () => {
  /** 分组切换是标签条上的按钮，同名的侧栏入口是 link，用 role 就能区分。 */
  function configTab(page: Page, name: string): Locator {
    return page.getByRole('button', { name, exact: true });
  }

  test('多类型字段形成差异，经完整校验后单次原子保存并提示重启', async ({ page, snapshot }) => {
    await page.goto('/config');
    await expect(page.getByRole('heading', { level: 1, name: '配置' })).toBeVisible();
    await page.getByLabel('app.port').fill('4317');
    await page.getByLabel('app.log_level').selectOption('debug');
    await configTab(page, '订阅').click();
    await page.getByLabel('subscription.enabled').check();
    await page.getByLabel('subscription.retry_delays_minutes').fill('2, 10, 30');
    await expect(page.getByText('4 个待保存差异')).toBeVisible();

    const validated = page.waitForResponse(response =>
      response.url().endsWith('/api/config/validate') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '校验草稿' }).click();
    expect((await validated).ok()).toBeTruthy();
    await expect(page.getByText('当前草稿已通过完整 schema 校验')).toBeVisible();

    const saved = page.waitForResponse(response =>
      response.url().endsWith('/api/config') && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: '原子保存全部差异' }).click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page.getByText('存在待重启字段')).toBeVisible();

    const writes = requests(await snapshot(), 'PATCH', '/api/config');
    expect(writes).toHaveLength(1);
    const body = writes[0]?.body as { changes?: Array<{ path: string; value: unknown }> } | undefined;
    expect(body?.changes).toEqual(expect.arrayContaining([
      { path: 'app.port', value: 4317 },
      { path: 'app.log_level', value: 'debug' },
      { path: 'subscription.enabled', value: true },
      { path: 'subscription.retry_delays_minutes', value: [2, 10, 30] },
    ]));
  });

  test('放弃草稿不写后端；校验和保存失败均保持差异', async ({ page, control, snapshot }) => {
    await page.goto('/config');
    const port = page.getByLabel('app.port');
    const original = await port.inputValue();
    await port.fill('4318');
    await page.getByRole('button', { name: '放弃草稿' }).click();
    await expect(port).toHaveValue(original);
    expect(requests(await snapshot(), 'PATCH', '/api/config')).toEqual([]);

    await control({ configValidationFailure: true });
    await port.fill('4319');
    await page.getByRole('button', { name: '校验草稿' }).click();
    await expect(page.getByText('配置操作失败')).toBeVisible();
    await expect(page.getByText('1 个待保存差异')).toBeVisible();

    await control({ configValidationFailure: false, configSaveFailure: true });
    await page.getByRole('button', { name: '原子保存全部差异' }).click();
    await expect(page.getByText('配置操作失败')).toBeVisible();
    await expect(page.getByText('1 个待保存差异')).toBeVisible();
  });
});

test.describe('E17 · 配置导入、导出与恢复', () => {
  // 导入预览的入口已从配置页移除，但服务端契约还在，覆盖降到 API 层而不是删掉。
  test('导入预览只报告差异，不改变生效配置', async ({ request }) => {
    const before = await (await request.get('/api/config/effective')).json() as { data: { config: unknown } };
    const preview = await request.post('/api/config/import/preview', {
      data: { source: 'network:\n  request_timeout: 45000\n' },
    });
    expect(preview.ok()).toBeTruthy();
    const body = await preview.json() as {
      data: { differences: Array<{ path: string; before: unknown; after: unknown }> };
    };
    expect(body.data.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'network.request_timeout', after: 45000 }),
    ]));

    const after = await (await request.get('/api/config/effective')).json() as { data: { config: unknown } };
    expect(after.data.config).toEqual(before.data.config);
  });

  test('导出内容脱敏且不会改变生效配置', async ({ page }) => {
    await page.goto('/config');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: '导出脱敏配置' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('miobridge-config.yaml');
    const source = await downloadText(download);
    expect(source).toContain('<redacted>');
    expect(source).not.toMatch(/e2e-password|e2e-private-key|credentialRef/);
    expect(source).not.toMatch(/password:\s+(?!<redacted>)/);
  });

  test('确认后恢复 last-good 并刷新生效值', async ({ page }) => {
    await page.goto('/config');
    const port = page.getByLabel('app.port');
    const original = await port.inputValue();
    await port.fill('4320');
    await page.getByRole('button', { name: '原子保存全部差异' }).click();
    // 等「生效」而不是等输入框：输入框从打字那一刻就是 4320，保存后的重新拉取可能还在飞，
    // 那时点恢复，两次拉取会抢先后，恢复值会被旧响应盖掉。
    await expect(page.locator('.mb-card').filter({ has: page.getByLabel('app.port') }))
      .toContainText('生效：4320');

    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '恢复 last-good' }).click();
    await expect(page.getByText('已恢复 last-good 配置')).toBeVisible();
    await expect(port).toHaveValue(original);
  });
});

test.describe('E18 · Webhook 通知', () => {
  // Webhook 控件已从配置页移除；投递与历史仍是服务端契约，按 API 覆盖。
  test('测试通知只投递到 loopback sink，并写入持久化历史', async ({ request, snapshot }) => {
    // 配置里的 webhook URL 必须指向 harness 的 loopback sink，否则用例会真的出网。
    const effective = await (await request.get('/api/config/effective')).json() as {
      data: { config: { notifications?: { webhook?: { url?: string } } } };
    };
    expect(effective.data.config.notifications?.webhook?.url).toContain('/__e2e__/webhook');

    const sent = await request.post('/api/notifications/test');
    expect(sent.status()).toBe(200);
    expect((await sent.json() as { data: Record<string, unknown> }).data)
      .toMatchObject({ event: 'test', ok: true, statusCode: 204 });

    const history = await request.get('/api/notifications/history');
    expect(history.ok()).toBeTruthy();
    const body = await history.json() as { data: { records: Array<Record<string, unknown>> } };
    expect(body.data.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'test', ok: true }),
    ]));

    expect((await snapshot()).webhooks)
      .toEqual(expect.arrayContaining([expect.objectContaining({ event: 'test', status: 'ok' })]));
  });

  test('Webhook 非 2xx 时返回 502 并在历史里保留 HTTP 状态', async ({ request, control }) => {
    await control({ webhookStatus: 500 });
    const sent = await request.post('/api/notifications/test');
    expect(sent.status()).toBe(502);
    expect((await sent.json() as { data: Record<string, unknown> }).data)
      .toMatchObject({ event: 'test', ok: false, statusCode: 500 });

    const history = await request.get('/api/notifications/history');
    const body = await history.json() as { data: { records: Array<Record<string, unknown>> } };
    expect(body.data.records[0]).toMatchObject({ event: 'test', ok: false, statusCode: 500 });
  });
});

test.describe('E19 · 动态 OpenAPI', () => {
  test('实时契约按分组渲染，支持复制且仅 GET 提供打开动作', async ({ page }) => {
    await grantClipboard(page);
    await page.goto('/api-docs');
    await expect(page.getByText(/\d+ 个端点 · v/)).toBeVisible();

    const getTrigger = page.getByRole('button').filter({ has: page.getByText('/health', { exact: true }) });
    await getTrigger.click();
    const getEndpoint = getTrigger.locator('..');
    await expect(getEndpoint.getByRole('link', { name: '打开 GET' })).toBeVisible();
    await getEndpoint.getByRole('button', { name: '复制 URL' }).click();
    expect(await clipboardText(page)).toContain('/health');
    await getEndpoint.getByRole('button', { name: '复制 cURL' }).click();
    expect(await clipboardText(page)).toContain('curl -fsS');

    const postTrigger = page.getByRole('button')
      .filter({ has: page.getByText('/api/subscription-jobs', { exact: true }) })
      .filter({ has: page.getByText('POST', { exact: true }) });
    await postTrigger.click();
    const postEndpoint = postTrigger.locator('..');
    await expect(postEndpoint.getByRole('link', { name: '打开 GET' })).toHaveCount(0);
    await expect(postEndpoint.locator('pre')).toContainText('-X POST');
  });

  test('写接口契约的 cURL 带 JSON 请求体占位', async ({ page }) => {
    await page.goto('/api-docs');
    const trigger = page.getByRole('button')
      .filter({ has: page.getByText('/api/deployments', { exact: true }) })
      .filter({ has: page.getByText('POST', { exact: true }) });
    await trigger.click();
    const command = trigger.locator('..').locator('pre');
    await expect(command).toContainText('-X POST');
    await expect(command).toContainText("-H 'Content-Type: application/json'");
    await expect(command).toContainText('--data');
  });

  test('契约加载失败可见，恢复后刷新文档重新渲染', async ({ page }) => {
    // ky 对 503 会自动重试，用 times: 1 只能挡住首次请求，重试就拿到了真实文档。
    // 这里拦住全部请求，确认错误态之后再解除拦截，验证「刷新文档」能恢复。
    const handler = (route: Route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'OpenAPI fixture unavailable' }),
    });
    await page.route('**/api/openapi.json', handler);
    await page.goto('/api-docs');
    await expect(page.getByText('无法读取 API 契约')).toBeVisible();
    await page.unroute('**/api/openapi.json', handler);
    await page.getByRole('button', { name: '刷新文档' }).click();
    await expect(page.getByText(/\d+ 个端点 · v/)).toBeVisible();
    await expect(page.getByText('无法读取 API 契约')).toHaveCount(0);
  });
});

test.describe('E20 · 安全、兼容 URL 与 API contract', () => {
  test('普通 API 响应不泄露凭据，手动 Agent 配置是唯一显式密钥出口', async ({ request }) => {
    const cluster = await request.get('/api/cluster/status', { headers: { 'X-Request-ID': 'security-cluster' } });
    expect(cluster.ok()).toBeTruthy();
    const clusterBody = await cluster.json() as { data: { nodes: Array<Record<string, unknown>> } };
    expect(sensitiveKeys(clusterBody)).toEqual([]);
    const nodeId = String(clusterBody.data.nodes[0]?.nodeId ?? clusterBody.data.nodes[0]?.id ?? '');
    expect(nodeId).not.toBe('');

    const manual = await request.get(`/api/deployments/agent/manual-config?nodeId=${encodeURIComponent(nodeId)}`);
    expect(manual.ok()).toBeTruthy();
    expect(manual.headers()['content-type']).toContain('application/yaml');
    expect(manual.headers()['content-disposition']).toContain(`miobridge-agent-${nodeId}.yaml`);
    expect(await manual.text()).toMatch(/secret:\s*\S+/);
  });

  test('幂等键复用同一任务，成功与错误 envelope 均保留请求关联字段', async ({ request }) => {
    const headers = { 'Idempotency-Key': 'subscription-e20', 'X-Request-ID': 'request-e20' };
    const first = await request.post('/api/subscription-jobs', { headers });
    const second = await request.post('/api/subscription-jobs', { headers });
    expect(first.status()).toBe(202);
    expect(second.status()).toBe(202);
    const firstBody = await first.json() as { data: { jobId: string }; requestId: string; role: string };
    const secondBody = await second.json() as { data: { jobId: string }; requestId: string; role: string };
    expect(secondBody.data.jobId).toBe(firstBody.data.jobId);
    expect(firstBody).toMatchObject({ requestId: 'request-e20', role: 'admin' });
    expect(first.headers()['x-request-id']).toBe('request-e20');

    const missing = await request.get('/api/subscription-jobs/not-found', { headers: { 'X-Request-ID': 'missing-e20' } });
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toMatchObject({
      success: false,
      requestId: 'missing-e20',
      role: 'admin',
      error: { code: 'JOB_NOT_FOUND', message: expect.any(String), retryable: false },
    });
  });

  test('健康检查与三个公共兼容 URL 返回稳定内容类型，未知 API 不落入 SPA', async ({ request }) => {
    const health = await request.get('/health');
    expect(health.ok()).toBeTruthy();
    expect(await health.json()).toMatchObject({ status: expect.stringMatching(/ok|healthy/) });

    const contracts = [
      ['/raw.txt', 'text/plain'],
      ['/subscription.txt', 'text/plain'],
      ['/clash.yaml', 'text/yaml'],
    ] as const;
    for (const [path, contentType] of contracts) {
      const response = await request.get(path);
      expect(response.ok(), path).toBeTruthy();
      expect(response.headers()['content-type'], path).toContain(contentType);
      // 默认 inline，订阅客户端与「打开」都直接读取内容；
      // 只有显式 ?download=1 才让浏览器另存为，否则「打开」与「下载」无从区分。
      expect(response.headers()['content-disposition'], path).toContain('inline');
      expect((await response.text()).length, path).toBeGreaterThan(0);

      const download = await request.get(`${path}?download=1`);
      expect(download.ok(), path).toBeTruthy();
      expect(download.headers()['content-disposition'], path).toContain('attachment');
    }

    const missing = await request.get('/api/not-a-real-route');
    expect(missing.status()).toBe(404);
    expect(missing.headers()['content-type'] ?? '').not.toContain('text/html');
  });

  test('SPA 未调用的只读兼容 API 保持可达且返回约定内容类型', async ({ request }) => {
    const contracts = [
      { path: '/api/update', contentType: 'application/json' },
      { path: '/api/file/subscription', contentType: 'text/plain' },
      { path: '/api/file/clash', contentType: 'text/yaml' },
      { path: '/api/file/raw', contentType: 'text/plain' },
      { path: '/api/configs', contentType: 'application/json' },
      { path: '/api/yaml/config', contentType: 'application/json' },
      { path: '/api/yaml/frontend', contentType: 'application/json' },
      { path: '/api/yaml/validate', contentType: 'application/json' },
      { path: '/api/diagnose/mihomo', contentType: 'application/json' },
      { path: '/api/test/protocols', contentType: 'application/json' },
      { path: '/api/diagnostics', contentType: 'application/json' },
      { path: '/api/cluster/deploy/status', contentType: 'application/json' },
    ] as const;

    for (const contract of contracts) {
      await test.step(`GET ${contract.path}`, async () => {
        const response = await request.get(contract.path);
        expect(response.status(), contract.path).toBe(200);
        expect(response.headers()['content-type'] ?? '', contract.path).toContain(contract.contentType);
        const source = await response.text();
        expect(source.trim().length, contract.path).toBeGreaterThan(0);
        if (contract.contentType === 'application/json') {
          expect(JSON.parse(source), contract.path).toEqual(expect.any(Object));
        }
      });
    }
  });

  test('HTTP adapter 拒绝超大 body 与非法 JSON 时返回规范错误 envelope', async ({ request }) => {
    const cases = [
      {
        name: 'payload-too-large',
        requestId: 'adapter-payload-too-large',
        data: Buffer.alloc(1024 * 1024 + 1, 'x'),
        contentType: 'text/plain',
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
      },
      {
        name: 'invalid-json',
        requestId: 'adapter-invalid-json',
        data: Buffer.from('{"invalid":'),
        contentType: 'application/json',
        status: 400,
        code: 'INVALID_JSON',
      },
    ] as const;

    for (const entry of cases) {
      await test.step(entry.name, async () => {
        const response = await request.post('/api/configs', {
          headers: { 'Content-Type': entry.contentType, 'X-Request-ID': entry.requestId },
          data: entry.data,
        });
        const source = await response.text();
        let body: unknown = {};
        try { body = JSON.parse(source); } catch { /* The missing JSON envelope is itself asserted below. */ }
        expect.soft(response.status(), entry.name).toBe(entry.status);
        expect.soft(response.headers()['x-request-id'], entry.name).toBe(entry.requestId);
        expect.soft(body, entry.name).toMatchObject({
          success: false,
          requestId: entry.requestId,
          role: 'admin',
          timestamp: expect.any(String),
          error: { code: entry.code, message: expect.any(String), retryable: false },
        });
      });
    }
  });

  test('HTTP adapter 对不支持的方法返回 405 与 Allow，且不会落入 SPA', async ({ request }) => {
    const response = await request.fetch('/api/status', { method: 'TRACE' });
    expect(response.status()).toBe(405);
    expect(response.headers()['allow']).toContain('GET');
    expect(response.headers()['content-type'] ?? '').not.toContain('text/html');
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: expect.any(String), retryable: false },
    });
  });

  test('HTTP adapter 原样回传调用方提供的 X-Request-ID', async ({ request }) => {
    const requestId = 'adapter-request-id-e20';
    const response = await request.get('/api/status', { headers: { 'X-Request-ID': requestId } });
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['x-request-id']).toBe(requestId);
  });
});
