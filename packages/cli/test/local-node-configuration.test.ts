import { describe, expect, it, vi } from 'vitest';
import { NodeRepository, type StateStore } from '@miobridge/core';
import { LocalNodeConfigurationService } from '../src/nodes/localConfiguration.js';

function memoryStore(): StateStore {
  let value: string | null = null;
  return {
    kind: 'file',
    get: async () => value,
    set: async (_key, next) => { value = next; },
    del: async () => { value = null; },
    listKeys: async () => [],
    withLock: async (_key, callback) => callback(),
  };
}

describe('local node configuration', () => {
  it('prompts during interactive setup and persists the selected role', async () => {
    const repository = new NodeRepository(memoryStore());
    const confirm = vi.fn(async () => true);
    const service = new LocalNodeConfigurationService(repository, { confirm });
    await expect(service.configure()).resolves.toMatchObject({ enabled: true, changed: true });
    expect(confirm).toHaveBeenCalledOnce();
    expect(await repository.isLocalNodeConfigured()).toBe(true);
  });

  it('supports explicit disable without prompting', async () => {
    const repository = new NodeRepository(memoryStore());
    await repository.configureLocalNode(true);
    const confirm = vi.fn(async () => true);
    const service = new LocalNodeConfigurationService(repository, { confirm });
    await expect(service.configure({ enabled: false })).resolves.toMatchObject({ enabled: false, changed: true });
    expect(confirm).not.toHaveBeenCalled();
    expect(await repository.isLocalNodeConfigured()).toBe(false);
  });
});
