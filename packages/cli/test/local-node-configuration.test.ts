import { describe, expect, it, vi } from 'vitest';
import { NodeRepository, type StateStore } from '@miobridge/core';
import { LocalNodeConfigurationService } from '../src/nodes/localConfiguration.js';

function memoryStore(): StateStore {
  let value: string | null = null;
  return {
    kind: 'file', get: async () => value, set: async (_key, next) => { value = next; },
    del: async () => { value = null; }, listKeys: async () => [], withLock: async (_key, callback) => callback(),
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

  it('enables the local profile by default for non-interactive installation', async () => {
    const repository = new NodeRepository(memoryStore());
    const confirm = vi.fn(async () => false);
    const service = new LocalNodeConfigurationService(repository, { confirm });
    await expect(service.configure({ assumeYes: true })).resolves.toMatchObject({ enabled: true, changed: true });
    expect(confirm).not.toHaveBeenCalled();
    expect((await repository.list())[0]).toMatchObject({
      id: 'local', host: '127.0.0.1', kernels: [
        { type: 'sing-box' }, { type: 'xray' }, { type: 'v2ray' },
      ],
      agent: { deployed: false, status: 'not_deployed', port: 3001 },
    });
  });

  it('exports every monitored kernel into the local Agent bootstrap config', async () => {
    const repository = new NodeRepository(memoryStore());
    await repository.configureLocalNode(true);
    await repository.update('local', node => ({ ...node, kernels: [
      { type: 'sing-box' }, { type: 'xray', configPath: '/custom/xray.json' }, { type: 'v2ray' },
    ] }));
    const config = await new LocalNodeConfigurationService(repository, { confirm: async () => true }).agentConfig();
    expect(config).toContain('type: sing-box');
    expect(config).toContain('type: xray');
    expect(config).toContain('/custom/xray.json');
    expect(config).toContain('type: v2ray');
  });

  it('fills a legacy sing-box-only local profile forward to all supported kernels', async () => {
    const repository = new NodeRepository(memoryStore());
    await repository.save([{
      id: 'local', name: '本机节点', host: '127.0.0.1', secret: 'secret',
      kernels: [{ type: 'sing-box', configPath: '/custom/sing-box.json' }],
      location: '本机', enabled: true,
    }]);
    await repository.configureLocalNode(true);
    expect((await repository.list())[0]?.kernels).toEqual([
      { type: 'sing-box', configPath: '/custom/sing-box.json' },
      { type: 'xray' },
      { type: 'v2ray' },
    ]);
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
