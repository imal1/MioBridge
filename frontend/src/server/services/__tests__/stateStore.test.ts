import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { getStateStore, resetStateStoreForTests } from '../stateStore';

const ENV_KEYS = [
  'MIOBRIDGE_CONFIG_DIR',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  resetStateStoreForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  resetStateStoreForTests();
  vi.restoreAllMocks();
});

describe('FileStateStore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'miobridge-statestore-'));
    process.env.MIOBRIDGE_CONFIG_DIR = tmpDir;
    resetStateStoreForTests();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('is selected when no redis env vars are present', () => {
    expect(getStateStore().kind).toBe('file');
  });

  it('round-trips values as files under the config dir', async () => {
    const store = getStateStore();

    expect(await store.get('nodes.yaml')).toBeNull();

    await store.set('nodes.yaml', 'nodes:\n');
    expect(await store.get('nodes.yaml')).toBe('nodes:\n');
    expect(await fs.pathExists(path.join(tmpDir, 'nodes.yaml'))).toBe(true);

    await store.del('nodes.yaml');
    expect(await store.get('nodes.yaml')).toBeNull();
  });

  it('lists keys by prefix, including nested ones', async () => {
    const store = getStateStore();
    await store.set('deploy-progress/node-a', '{}');
    await store.set('deploy-progress/node-b', '{}');
    await store.set('nodes.yaml', 'nodes:\n');

    const keys = await store.listKeys('deploy-progress/');
    expect(keys.sort()).toEqual(['deploy-progress/node-a', 'deploy-progress/node-b']);
  });

  it('rejects keys that escape the config dir', async () => {
    const store = getStateStore();
    await expect(store.get('../outside')).rejects.toThrow('非法的 state key');
  });
});

describe('RedisStateStore', () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    resetStateStoreForTests();
  });

  function mockRedis(result: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result }),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('is selected when redis env vars are present', () => {
    expect(getStateStore().kind).toBe('redis');
  });

  it('sends namespaced GET/SET/DEL commands', async () => {
    const fetchMock = mockRedis('ok');
    const store = getStateStore();

    await store.set('nodes.yaml', 'nodes:\n', 60);
    await store.get('nodes.yaml');
    await store.del('nodes.yaml');

    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies[0]).toEqual(['SET', 'miobridge:nodes.yaml', 'nodes:\n', 'EX', 60]);
    expect(bodies[1]).toEqual(['GET', 'miobridge:nodes.yaml']);
    expect(bodies[2]).toEqual(['DEL', 'miobridge:nodes.yaml']);

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-token' });
  });

  it('strips the namespace from listKeys results', async () => {
    mockRedis(['miobridge:deploy-progress/node-a', 'miobridge:deploy-progress/node-b']);
    const store = getStateStore();

    const keys = await store.listKeys('deploy-progress/');
    expect(keys).toEqual(['deploy-progress/node-a', 'deploy-progress/node-b']);
  });

  it('surfaces redis errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: 'WRONGPASS' }),
    }));
    const store = getStateStore();

    await expect(store.get('nodes.yaml')).rejects.toThrow('WRONGPASS');
  });
});
