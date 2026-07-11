import { describe, expect, it } from 'vitest';
import {
  clearDeployStatus,
  getDeployStatus,
  setDeployStatus,
} from '../deployProgressStore';
import type { DeployStatus } from '../../types';

const oldStartedAt = Date.now() - 10 * 60 * 1000;

function status(overrides: Partial<DeployStatus>): DeployStatus {
  return {
    nodeId: 'node-progress-test',
    step: 'agent',
    status: 'running',
    message: 'uploading',
    progress: 60,
    startedAt: oldStartedAt,
    ...overrides,
  };
}

describe('deployProgressStore', () => {
  it('keeps long-running deployments past the completed-status TTL', async () => {
    await setDeployStatus('node-progress-test', status({ status: 'running' }));

    expect((await getDeployStatus('node-progress-test'))?.status).toBe('running');

    await clearDeployStatus('node-progress-test');
  });

  it('expires stale terminal deployments', async () => {
    await setDeployStatus('node-progress-test', status({ status: 'success' }));

    expect(await getDeployStatus('node-progress-test')).toBeNull();
  });
});
