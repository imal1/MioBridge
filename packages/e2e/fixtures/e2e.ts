import { expect, test as base, type APIRequestContext } from '@playwright/test';

export interface HarnessRequest {
  readonly method: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface HarnessSnapshot {
  readonly requests: readonly HarnessRequest[];
  readonly nodes: readonly Record<string, unknown>[];
  readonly deploymentTasks: readonly Record<string, unknown>[];
  readonly subscriptionJobs?: readonly Record<string, unknown>[];
  readonly downloadedManualConfigs?: number;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly policy?: Readonly<Record<string, unknown>>;
  readonly artifacts?: readonly Record<string, unknown>[];
  readonly webhooks?: readonly Record<string, unknown>[];
  readonly webhookStatus?: number;
  readonly [key: string]: unknown;
}

interface HarnessFixtures {
  readonly control: (flags: Readonly<Record<string, unknown>>) => Promise<void>;
  readonly snapshot: () => Promise<HarnessSnapshot>;
  readonly resetHarness: void;
}

async function assertControlResponse(response: Awaited<ReturnType<APIRequestContext['post']>>, action: string) {
  expect(response.ok(), `${action}: ${response.status()} ${await response.text()}`).toBeTruthy();
}

export const test = base.extend<HarnessFixtures>({
  resetHarness: [async ({ request }, use) => {
    const response = await request.post('/__e2e__/reset', { data: { scenario: 'baseline' } });
    await assertControlResponse(response, 'reset harness');
    await use();
  }, { auto: true }],

  context: async ({ context, baseURL }, use) => {
    const allowedOrigin = new URL(baseURL ?? 'http://127.0.0.1:4173').origin;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === allowedOrigin || url.protocol === 'data:' || url.protocol === 'blob:') {
        await route.continue();
        return;
      }
      await route.abort('blockedbyclient');
    });
    await use(context);
  },

  control: async ({ request }, use) => {
    await use(async flags => {
      const response = await request.post('/__e2e__/control', { data: flags });
      await assertControlResponse(response, 'update harness controls');
    });
  },

  snapshot: async ({ request }, use) => {
    await use(async () => {
      const response = await request.get('/__e2e__/state');
      expect(response.ok(), `snapshot: ${response.status()} ${await response.text()}`).toBeTruthy();
      return await response.json() as HarnessSnapshot;
    });
  },
});

export { expect };
