import type { DashboardRequest, DashboardServerDependencies } from '@miobridge/cli';
import { createOperations } from './operations.js';
import {
  controlHarnessState,
  createHarnessState,
  harnessSnapshot,
  recordHarnessRequest,
  resetHarnessState,
} from './state.js';
import {
  createConfigPort,
  createConvertPort,
  createCorePort,
  createSubscriptionPort,
  createYamlPort,
} from './ports.js';

export interface E2EHarness {
  readonly dependencies: DashboardServerDependencies;
  reset(scenario?: string): Promise<void>;
  control(flags: Readonly<Record<string, unknown>>): Promise<void>;
  snapshot(): Promise<Record<string, unknown>>;
  recordRequest(request: DashboardRequest): void;
  recordWebhook(body: unknown): void;
}

export async function createE2EHarness(options: { readonly origin: string }): Promise<E2EHarness> {
  const state = createHarnessState(options.origin);
  const dependencies: DashboardServerDependencies = {
    core: createCorePort(state),
    operations: createOperations(state),
    subscription: createSubscriptionPort(state),
    config: createConfigPort(state),
    yaml: createYamlPort(state),
    convert: createConvertPort(state),
  };

  return {
    dependencies,
    async reset(scenario = 'baseline') { resetHarnessState(state, options.origin, scenario); },
    async control(flags) { controlHarnessState(state, flags); },
    async snapshot() { return harnessSnapshot(state); },
    recordRequest(request) { recordHarnessRequest(state, request); },
    recordWebhook(body) {
      const value = body && typeof body === 'object' && !Array.isArray(body)
        ? structuredClone(body as Record<string, unknown>)
        : { body: structuredClone(body) };
      state.webhooks.push(value);
    },
  };
}
