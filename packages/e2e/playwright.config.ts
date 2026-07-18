import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));
const baseURL = process.env.MIOBRIDGE_E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const serverUrl = new URL(baseURL);
if (serverUrl.hostname !== '127.0.0.1') {
  throw new Error(`MIOBRIDGE_E2E_BASE_URL must stay on 127.0.0.1, received ${serverUrl.hostname}`);
}
const serverPort = serverUrl.port || '80';

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
    video: 'retain-on-failure',
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
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
});
