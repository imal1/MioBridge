import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConfigService,
  FileStateStore,
  YamlService,
  createRuntimePaths,
  createStateStore,
} from '../src/index.js';

const temporaryDirectories: string[] = [];
async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'miobridge-core-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('RuntimePaths', () => {
  it('isolates each instance from later environment and cwd changes', async () => {
    const first = await temporaryDirectory();
    const second = await temporaryDirectory();
    const env = { MIOBRIDGE_CONFIG_DIR: first, PATH: ['/one', '/two'].join(delimiter) };
    const paths = createRuntimePaths({ env, applicationRoot: '/opt/miobridge' });
    env.MIOBRIDGE_CONFIG_DIR = second;

    expect(paths.baseDir).toBe(first);
    expect(paths.binaryCandidates('mihomo')).toEqual([
      join(first, 'bin', 'mihomo'),
      join(resolve('/opt/miobridge'), 'bin', 'mihomo'),
      join('/one', 'mihomo'),
      join('/two', 'mihomo'),
    ]);
  });

  it('normalizes trailing separators and rejects traversal', async () => {
    const directory = await temporaryDirectory();
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: `${directory}${sep}` } });
    expect(paths.baseDir).toBe(directory);
    expect(() => paths.managedPath('../outside')).toThrow('escapes');
  });

});

describe('StateStore', () => {
  it('round-trips compatible files, permissions, prefixes, and locks', async () => {
    const directory = await temporaryDirectory();
    const store = new FileStateStore(createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: directory } }));
    await store.set('deploy-progress/node-a', '{}');
    await store.set('nodes.yaml', 'nodes:\n');

    expect(await readFile(join(directory, 'nodes.yaml'), 'utf8')).toBe('nodes:\n');
    // POSIX mode bits are meaningless on Windows (NTFS only honours the read-only bit).
    if (process.platform !== 'win32') expect((await stat(join(directory, 'nodes.yaml'))).mode & 0o777).toBe(0o600);
    expect(await store.listKeys('deploy-progress/')).toEqual(['deploy-progress/node-a']);
    await expect(store.get('../outside')).rejects.toThrow('非法的 state key');

    const order: string[] = [];
    await Promise.all([
      store.withLock('nodes.yaml', async () => { order.push('a'); await new Promise(resolve => setTimeout(resolve, 10)); order.push('b'); }),
      store.withLock('nodes.yaml', async () => { order.push('c'); }),
    ]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('preserves Redis environment precedence, namespace, and lock wire format', async () => {
    const commands: (string | number)[][] = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as (string | number)[];
      commands.push(command);
      return { ok: true, json: async () => ({ result: command.includes('NX') ? 'OK' : command[0] === 'KEYS' ? ['miobridge:nodes.yaml'] : 'OK' }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: await temporaryDirectory() } });
    const store = createStateStore({ paths, env: { UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 'token' } });

    await store.set('nodes.yaml', 'nodes:\n', 60);
    expect(await store.listKeys('nodes')).toEqual(['nodes.yaml']);
    await store.withLock('nodes.yaml', async () => 'done');

    expect(commands[0]).toEqual(['SET', 'miobridge:nodes.yaml', 'nodes:\n', 'EX', 60]);
    expect(commands[2]?.slice(0, 2)).toEqual(['SET', 'miobridge:lock:nodes.yaml']);
    expect(commands.at(-1)?.[0]).toBe('EVAL');
  });
});

describe('YamlService and ConfigService', () => {
  it('has no constructor-time filesystem side effects and retains defaults', async () => {
    const directory = await temporaryDirectory();
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: directory } });
    const yaml = new YamlService({ paths });
    const config = new ConfigService(yaml, paths, '1.2.3');

    expect(config.getAppVersion()).toBe('1.2.3');
    expect(config.getConfig()).toMatchObject({
      staticDir: join(directory, 'www'),
      logDir: join(directory, 'log'),
      backupDir: join(directory, 'backup'),
      requestTimeout: 30_000,
    });
    expect(yaml.configExists()).toBe(false);
  });

  it('updates managed config without an external YAML executable', async () => {
    const directory = await temporaryDirectory();
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: directory } });
    const yaml = new YamlService({ paths });
    yaml.updateSingBoxConfigs(['vless', 'trojan']);
    expect(yaml.validateConfig()).toBe(true);
    expect(yaml.getFullConfig().protocols?.sing_box_configs).toEqual(['vless', 'trojan']);
    expect(await readFile(paths.configFile, 'utf8')).toContain('sing_box_configs');
  });

  it('preserves configured data, log, backup, and mihomo paths', async () => {
    const directory = await temporaryDirectory();
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: directory } });
    const yaml = { getFullConfig: () => ({ binaries: { mihomo_path: '/custom/mihomo' }, directories: {
      data_dir: '/custom/data', log_dir: '/custom/log', backup_dir: '/custom/backup',
    } }) } as YamlService;
    expect(new ConfigService(yaml, paths, '1').getConfig()).toMatchObject({
      mihomoPath: '/custom/mihomo', staticDir: '/custom/data', logDir: '/custom/log', backupDir: '/custom/backup',
    });
  });

  it('restricts schema paths and atomically applies, validates, backs up, and restores config', async () => {
    const directory = await temporaryDirectory();
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: directory } });
    const yaml = new YamlService({ paths });
    yaml.replaceConfig({ app: { port: 3000 }, network: { request_timeout: 30_000 }, protocols: { sing_box_configs: ['default'] } });
    const config = new ConfigService(yaml, paths, '1.0.0');

    expect(() => config.getConfigByPath('app.name')).toThrow('不支持的配置字段');
    const applied = config.setConfigValues([
      { path: 'app.port', value: 4000 },
      { path: 'network.request_timeout', value: 5_000 },
    ]);
    expect(applied).toMatchObject({ restartRequired: true, results: [{ path: 'app.port' }, { path: 'network.request_timeout' }] });
    expect(config.getConfigByPath('app.port')).toBe(4000);
    if (process.platform !== 'win32') expect((await stat(paths.configFile)).mode & 0o777).toBe(0o600);

    const beforeInvalid = await readFile(paths.configFile, 'utf8');
    expect(() => config.setConfigValues([{ path: 'app.port', value: 70_000 }])).toThrow('不能大于');
    expect(await readFile(paths.configFile, 'utf8')).toBe(beforeInvalid);

    config.setConfigByPath('app.port', 5000);
    expect(config.restoreLastGood()).toMatchObject({ restored: true });
    expect(config.getConfigByPath('app.port')).toBe(4000);
    await writeFile(`${paths.configFile}.last-good`, 'app:\n  port: 70000\n', 'utf8');
    expect(() => config.restoreLastGood()).toThrow('不能大于');
    expect(config.getConfigByPath('app.port')).toBe(4000);
    await writeFile(`${paths.configFile}.last-good`, 'not: [valid', 'utf8');
    expect(() => config.restoreLastGood()).toThrow();
    expect(config.getConfigByPath('app.port')).toBe(4000);
  });
});
