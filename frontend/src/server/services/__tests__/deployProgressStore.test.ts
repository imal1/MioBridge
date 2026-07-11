import { describe, expect, it } from 'vitest';
import {
  beginDeployStatus,
  clearDeployStatus,
  getDeployStatus,
  setDeployStatusIfCurrent,
  setDeployStatus,
} from '../deployProgressStore';
import type { DeployStatus } from '../../types';

const oldStartedAt = Date.now() - 10 * 60 * 1000;

function status(overrides: Partial<DeployStatus>): DeployStatus {
  return {
    nodeId: 'node-progress-test',
    deploymentId: 'deploy-a',
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

  it('rejects late progress from an older deployment generation', async () => {
    await beginDeployStatus('node-progress-test', status({ deploymentId: 'deploy-a', startedAt: Date.now() }));
    await beginDeployStatus('node-progress-test', status({ deploymentId: 'deploy-b', startedAt: Date.now() }));

    const written = await setDeployStatusIfCurrent(
      'node-progress-test',
      'deploy-a',
      status({ deploymentId: 'deploy-a', progress: 100, startedAt: Date.now() }),
    );

    expect(written).toBe(false);
    expect((await getDeployStatus('node-progress-test'))?.deploymentId).toBe('deploy-b');
    await clearDeployStatus('node-progress-test');
  });
});
