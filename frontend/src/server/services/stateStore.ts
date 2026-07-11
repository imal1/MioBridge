import * as path from 'path';
import * as fs from 'fs-extra';
import { getMioBridgeBaseDir } from '../runtimePaths';
import { logger } from '../utils/logger';

/**
 * 持久化 KV 抽象层。
 *
 * 自托管模式：落盘到 `~/.config/miobridge/<key>`，与既有文件布局完全一致
 * （key "nodes.yaml" 即原来的 nodes.yaml 路径）。
 *
 * Vercel serverless：函数实例间没有共享文件系统，/tmp 随实例回收，
 * 文件写入无法跨请求存活。配置 Upstash/Vercel KV 的 REST 环境变量后
 * 自动切换到 Redis 后端（纯 fetch 实现，无额外依赖）：
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
}

const REDIS_KEY_NS = 'miobridge:';

class FileStateStore implements StateStore {
  readonly kind = 'file' as const;
  private readonly baseDir = getMioBridgeBaseDir();

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
    await fs.writeFile(file, value);
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
}

class RedisStateStore implements StateStore {
  readonly kind = 'redis' as const;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async command<T>(cmd: (string | number)[]): Promise<T> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cmd),
    });

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
