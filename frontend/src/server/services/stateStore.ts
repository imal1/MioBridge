import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import { getMioBridgeBaseDir } from '../runtimePaths';
import { logger } from '../utils/logger';

/**
 * 持久化 KV 抽象层。
 *
 * 文件后端（默认）：落盘到 `getMioBridgeBaseDir()/<key>`——自托管即
 * `~/.config/miobridge/`（key "nodes.yaml" 就是原来的 nodes.yaml 路径）；
 * Vercel 上未配置 Redis 时是 `/tmp/miobridge/`，随实例回收（启动时有警告）。
 *
 * Redis 后端：Vercel 函数实例间没有共享文件系统，配置 Upstash/Vercel KV
 * 的 REST 环境变量后自动切换（纯 fetch 实现，无额外依赖）：
 *
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN（Upstash 原生）
 *   或 KV_REST_API_URL + KV_REST_API_TOKEN（Vercel KV / Marketplace 集成）
 */
export interface StateStore {
  readonly kind: 'file' | 'redis';
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
  /**
   * 串行化对某个 key 的读-改-写事务：进程内按 key 排队；
   * Redis 后端额外持有跨实例互斥锁，防止多实例并发编辑丢失更新。
   */
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

const REDIS_KEY_NS = 'miobridge:';
const REDIS_TIMEOUT_MS = 5_000;
const LOCK_TTL_SECONDS = 10;
const LOCK_MAX_ATTEMPTS = 10;

/** 进程内按 key 串行化（同实例并发的读-改-写也会互相覆盖） */
class KeyedMutex {
  private chains = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(key, next.catch(() => undefined));
    return next;
  }
}

class FileStateStore implements StateStore {
  readonly kind = 'file' as const;
  private readonly baseDir = getMioBridgeBaseDir();
  private readonly mutex = new KeyedMutex();

  private filePath(key: string): string {
    const resolved = path.join(this.baseDir, key);
    if (!resolved.startsWith(this.baseDir + path.sep)) {
      throw new Error(`非法的 state key: ${key}`);
    }
    return resolved;
  }

  async get(key: string): Promise<string | null> {
    const file = this.filePath(key);
    if (!(await fs.pathExists(file))) return null;
    return fs.readFile(file, 'utf8');
  }

  async set(key: string, value: string): Promise<void> {
    const file = this.filePath(key);
    await fs.ensureDir(path.dirname(file));
    await fs.writeFile(file, value, { mode: 0o600 });
    await fs.chmod(file, 0o600);
  }

  async del(key: string): Promise<void> {
    await fs.remove(this.filePath(key));
  }

  async listKeys(prefix: string): Promise<string[]> {
    const sepIdx = prefix.lastIndexOf('/');
    const relDir = sepIdx === -1 ? '' : prefix.slice(0, sepIdx);
    const base = sepIdx === -1 ? prefix : prefix.slice(sepIdx + 1);
    const dir = relDir ? this.filePath(relDir) : this.baseDir;

    if (!(await fs.pathExists(dir))) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isFile() && entry.name.startsWith(base))
      .map(entry => (relDir ? `${relDir}/${entry.name}` : entry.name));
  }

  withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // 单进程部署：进程内互斥即可
    return this.mutex.run(key, fn);
  }
}

class RedisStateStore implements StateStore {
  readonly kind = 'redis' as const;
  private readonly mutex = new KeyedMutex();

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async command<T>(cmd: (string | number)[]): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REDIS_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cmd),
        signal: controller.signal,
      });
    } catch (error: any) {
      throw error?.name === 'AbortError'
        ? new Error(`Redis REST 请求超时 (${REDIS_TIMEOUT_MS}ms)`)
        : error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Redis REST HTTP ${response.status}`);
    }

    const json = await response.json() as { result?: T; error?: string };
    if (json.error) {
      throw new Error(`Redis: ${json.error}`);
    }
    return json.result as T;
  }

  async get(key: string): Promise<string | null> {
    return this.command<string | null>(['GET', REDIS_KEY_NS + key]);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const cmd: (string | number)[] = ['SET', REDIS_KEY_NS + key, value];
    if (ttlSeconds) cmd.push('EX', ttlSeconds);
    await this.command(cmd);
  }

  async del(key: string): Promise<void> {
    await this.command(['DEL', REDIS_KEY_NS + key]);
  }

  async listKeys(prefix: string): Promise<string[]> {
    // 集群规模为个位数节点，KEYS 足够；转义 glob 特殊字符避免误匹配
    const pattern = (REDIS_KEY_NS + prefix).replace(/[*?[\]\\]/g, '\\$&') + '*';
    const keys = await this.command<string[]>(['KEYS', pattern]);
    return (keys || []).map(key => key.slice(REDIS_KEY_NS.length));
  }

  withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // 进程内先排队，再拿跨实例互斥锁
    return this.mutex.run(key, () => this.withDistributedLock(key, fn));
  }

  private async withDistributedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = `${REDIS_KEY_NS}lock:${key}`;
    const lockToken = crypto.randomUUID();
    let acquired = false;

    for (let attempt = 1; attempt <= LOCK_MAX_ATTEMPTS; attempt++) {
      const result = await this.command<string | null>(
        ['SET', lockKey, lockToken, 'NX', 'EX', LOCK_TTL_SECONDS],
      );
      if (result === 'OK') {
        acquired = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }

    if (!acquired) {
      // 可用性优先：锁迟迟拿不到（持有者崩溃靠 TTL 兜底）时降级为无锁写入并告警
      logger.warn(`StateStore: 获取 ${key} 分布式锁超时，降级为无锁写入`);
    }

    try {
      return await fn();
    } finally {
      if (acquired) {
        // 只释放自己持有的锁，避免误删他人（超时后重入）的锁
        await this.command([
          'EVAL',
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          lockKey,
          lockToken,
        ]).catch((error: any) => {
          logger.warn(`StateStore: 释放 ${key} 分布式锁失败: ${error.message}`);
        });
      }
    }
  }
}

function createStateStore(): StateStore {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (url && token) {
    logger.info('StateStore: 使用 Redis 后端持久化集群状态');
    return new RedisStateStore(url, token);
  }

  if (process.env.VERCEL === '1') {
    logger.warn(
      'StateStore: Vercel 环境未配置 Redis（UPSTASH_REDIS_REST_URL/TOKEN 或 KV_REST_API_URL/TOKEN），'
      + '节点与部署状态将随函数实例回收丢失',
    );
  }

  return new FileStateStore();
}

// 与 deployProgressStore 相同的 globalThis 单例模式，dev 热重载时复用实例
const globalState = globalThis as typeof globalThis & {
  __MIOBRIDGE_STATE_STORE__?: StateStore;
};

export function getStateStore(): StateStore {
  if (!globalState.__MIOBRIDGE_STATE_STORE__) {
    globalState.__MIOBRIDGE_STATE_STORE__ = createStateStore();
  }
  return globalState.__MIOBRIDGE_STATE_STORE__;
}

/** 仅供测试：重置单例（例如切换 env 后重新创建后端） */
export function resetStateStoreForTests(): void {
  delete globalState.__MIOBRIDGE_STATE_STORE__;
}
