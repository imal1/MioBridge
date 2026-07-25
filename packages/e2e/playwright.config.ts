import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));
const baseURL = process.env.MIOBRIDGE_E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const serverUrl = new URL(baseURL);
if (serverUrl.hostname !== '127.0.0.1') {
  throw new Error(`MIOBRIDGE_E2E_BASE_URL must stay on 127.0.0.1, received ${serverUrl.hostname}`);
}
const serverPort = serverUrl.port || '80';

// 本地用已装的系统 Chrome 跑，省掉 Playwright 自带 Chromium 的下载。
// 录像依赖 Playwright 自带的 ffmpeg，同一份缓存里也没有，所以一并关掉；
// trace 与失败截图不依赖外部二进制，仍然保留。CI 不设这个变量，走自带 Chromium。
const systemChrome = process.env.MIOBRIDGE_E2E_CHROME === '1';

export default defineConfig({
  testDir: './tests',
  outputDir: './.artifacts/test-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [
    ['line'],
    ['html', { outputFolder: '.artifacts/html', open: 'never' }],
    ['json', { outputFile: '.artifacts/results.json' }],
    ['junit', { outputFile: '.artifacts/junit.xml' }],
    ['./reporters/markdown.ts'],
  ],
  use: {
    baseURL,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: systemChrome ? 'off' : 'retain-on-failure',
  },
  webServer: {
    command: 'bun run server',
    cwd: packageRoot,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { MIOBRIDGE_E2E_PORT: serverPort },
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'desktop-chromium',
      testIgnore: /responsive\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], ...(systemChrome ? { channel: 'chrome' as const } : {}) },
    },
    {
      name: 'mobile-chromium',
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices['Pixel 7'], ...(systemChrome ? { channel: 'chrome' as const } : {}) },
    },
  ],
});
