import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { CoreLogger } from '../index.js';
import type { RuntimePaths } from '../runtime/runtimePaths.js';

export interface StateStore {
  readonly kind: 'file' | 'redis';
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

class KeyedMutex {
  private readonly chains = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.chains.get(key) ?? Promise.resolve()).then(fn, fn);
    this.chains.set(key, next.catch(() => undefined));
    return next;
  }
}

export class FileStateStore implements StateStore {
  readonly kind = 'file' as const;
  private readonly mutex = new KeyedMutex();
  constructor(private readonly paths: RuntimePaths) {}

  private filePath(key: string): string {
    const candidate = resolve(this.paths.baseDir, key);
    if (candidate === this.paths.baseDir || !candidate.startsWith(`${this.paths.baseDir}${sep}`)) {
      throw new Error(`非法的 state key: ${key}`);
    }
    return candidate;
  }
  async get(key: string): Promise<string | null> {
    try { return await readFile(this.filePath(key), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async set(key: string, value: string): Promise<void> {
    const file = this.filePath(key); await mkdir(dirname(file), { recursive: true });
    await writeFile(file, value, { mode: 0o600 }); await chmod(file, 0o600);
  }
  async del(key: string): Promise<void> { await rm(this.filePath(key), { force: true }); }
  async listKeys(prefix: string): Promise<string[]> {
    const index = prefix.lastIndexOf('/');
    const relativeDir = index < 0 ? '' : prefix.slice(0, index);
    const basename = index < 0 ? prefix : prefix.slice(index + 1);
    const directory = relativeDir ? this.filePath(relativeDir) : this.paths.baseDir;
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      return entries.filter(entry => entry.isFile() && entry.name.startsWith(basename))
        .map(entry => relativeDir ? `${relativeDir}/${entry.name}` : entry.name);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T> { return this.mutex.run(key, fn); }
}

const NS = 'miobridge:';
export class RedisStateStore implements StateStore {
  readonly kind = 'redis' as const;
  private readonly mutex = new KeyedMutex();
  constructor(private readonly url: string, private readonly token: string, private readonly logger?: CoreLogger) {}
  private async command<T>(command: (string | number)[]): Promise<T> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(this.url, { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: controller.signal });
      if (!response.ok) throw new Error(`Redis REST HTTP ${response.status}`);
      const json = await response.json() as { result?: T; error?: string };
      if (json.error) throw new Error(`Redis: ${json.error}`); return json.result as T;
    } catch (error) { if ((error as Error).name === 'AbortError') throw new Error('Redis REST 请求超时 (5000ms)'); throw error; }
    finally { clearTimeout(timeout); }
  }
  get(key: string) { return this.command<string | null>(['GET', NS + key]); }
  async set(key: string, value: string, ttlSeconds?: number) { const command: (string | number)[] = ['SET', NS + key, value]; if (ttlSeconds) command.push('EX', ttlSeconds); await this.command(command); }
  async del(key: string) { await this.command(['DEL', NS + key]); }
  async listKeys(prefix: string) { const keys = await this.command<string[]>(['KEYS', (NS + prefix).replace(/[*?[\]\\]/g, '\\$&') + '*']); return (keys ?? []).map(key => key.slice(NS.length)); }
  withLock<T>(key: string, fn: () => Promise<T>) { return this.mutex.run(key, () => this.distributedLock(key, fn)); }
  private async distributedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = `${NS}lock:${key}`; const token = randomUUID(); let acquired = false;
    for (let attempt = 1; attempt <= 10; attempt++) { if (await this.command<string | null>(['SET', lockKey, token, 'NX', 'EX', 10]) === 'OK') { acquired = true; break; } await new Promise(resolveWait => setTimeout(resolveWait, attempt * 100)); }
    if (!acquired) this.logger?.warn(`StateStore: 获取 ${key} 分布式锁超时，降级为无锁写入`);
    try { return await fn(); } finally { if (acquired) await this.command(['EVAL', "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, token]).catch(error => this.logger?.warn(`StateStore: 释放 ${key} 分布式锁失败`, { error })); }
  }
}

export interface StateStoreOptions { readonly paths: RuntimePaths; readonly env?: Record<string, string | undefined>; readonly logger?: CoreLogger }
export function createStateStore(options: StateStoreOptions): StateStore {
  const env = options.env ?? process.env;
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (url && token) return new RedisStateStore(url, token, options.logger);
  return new FileStateStore(options.paths);
}
