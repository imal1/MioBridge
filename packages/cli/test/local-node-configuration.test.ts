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

  it('enables without prompting when setup runs with --yes', async () => {
    const repository = new NodeRepository(memoryStore());
    const confirm = vi.fn(async () => false);
    const service = new LocalNodeConfigurationService(repository, { confirm });
    await expect(service.configure({ assumeYes: true })).resolves.toMatchObject({ enabled: true, changed: true });
    expect(confirm).not.toHaveBeenCalled();
    const [local] = await repository.list();
    expect(local).toMatchObject({ id: 'local', name: '本机节点', host: '127.0.0.1', kernels: [{ type: 'sing-box' }] });
  });

  it('supports explicit disable without prompting and keeps child nodes', async () => {
    const repository = new NodeRepository(memoryStore());
    await repository.configureLocalNode(true);
    await repository.save([...await repository.list({ enabledOnly: false }), {
      id: 'child-1', name: '子节点', host: '198.51.100.7', port: 3001, secret: 's',
      kernels: [{ type: 'sing-box' }], location: 'HK', enabled: true,
    }]);
    const confirm = vi.fn(async () => true);
    const service = new LocalNodeConfigurationService(repository, { confirm });
    await expect(service.configure({ enabled: false })).resolves.toMatchObject({ enabled: false, changed: true });
    expect(confirm).not.toHaveBeenCalled();
    expect(await repository.isLocalNodeConfigured()).toBe(false);
    expect((await repository.list()).map(node => node.id)).toEqual(['child-1']);
  });
});
