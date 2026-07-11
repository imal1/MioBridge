import type { DeployStatus } from '../types';
import { getStateStore } from './stateStore';
import { logger } from '../utils/logger';

/**
 * 部署进度存储 — 单节点单条当前状态。
 *
 * 内存 Map 是快路径（自托管单进程时即全部真相）；配置了 Redis 后端时
 * 双写并以 Redis 为准，让进度在 Vercel 的多个函数实例间可见。
 */
const globalState = globalThis as typeof globalThis & {
  __MIOBRIDGE_DEPLOY_PROGRESS__?: Map<string, DeployStatus>;
  __MIOBRIDGE_DEPLOY_WRITE_CHAIN__?: Promise<void>;
};
const deployProgress = globalState.__MIOBRIDGE_DEPLOY_PROGRESS__ ?? new Map<string, DeployStatus>();
globalState.__MIOBRIDGE_DEPLOY_PROGRESS__ = deployProgress;

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const KEY_PREFIX = 'deploy-progress/';
/** Redis TTL：终态清理由过期兜底，无需显式 cleanup */
const REDIS_TTL_SECONDS = 10 * 60;

function cleanup(): void {
  const now = Date.now();
  const entries = Array.from(deployProgress.entries());
  for (const [nodeId, status] of entries) {
    const isTerminal = status.status === 'success' || status.status === 'error';
    if (isTerminal && now - status.startedAt > TTL_MS) {
      deployProgress.delete(nodeId);
    }
  }
}

function isExpired(status: DeployStatus): boolean {
  const isTerminal = status.status === 'success' || status.status === 'error';
  return isTerminal && Date.now() - status.startedAt > TTL_MS;
}

/** 进度回调是同步触发的，用写链保证 Redis 写入顺序与回调顺序一致 */
function chainWrite(write: () => Promise<void>): Promise<void> {
  const chain = (globalState.__MIOBRIDGE_DEPLOY_WRITE_CHAIN__ ?? Promise.resolve())
    .then(write)
    .catch((error: any) => {
      logger.warn(`DeployProgressStore: Redis 写入失败: ${error.message}`);
    });
  globalState.__MIOBRIDGE_DEPLOY_WRITE_CHAIN__ = chain;
  return chain;
}

export async function getDeployStatus(nodeId: string): Promise<DeployStatus | null> {
  cleanup();

  const store = getStateStore();
  if (store.kind === 'redis') {
    try {
      const raw = await store.get(KEY_PREFIX + nodeId);
      if (raw) {
        const status = JSON.parse(raw) as DeployStatus;
        return isExpired(status) ? null : status;
      }
      return null;
    } catch (error: any) {
      logger.warn(`DeployProgressStore: Redis 读取失败，回退内存: ${error.message}`);
    }
  }

  return deployProgress.get(nodeId) || null;
}

export async function getAllDeployStatuses(): Promise<DeployStatus[]> {
  cleanup();

  const store = getStateStore();
  if (store.kind === 'redis') {
    try {
      const keys = await store.listKeys(KEY_PREFIX);
      const values = await Promise.all(keys.map(key => store.get(key)));
      return values
        .filter((raw): raw is string => Boolean(raw))
        .map(raw => JSON.parse(raw) as DeployStatus)
        .filter(status => !isExpired(status));
    } catch (error: any) {
      logger.warn(`DeployProgressStore: Redis 读取失败，回退内存: ${error.message}`);
    }
  }

  return Array.from(deployProgress.values());
}

export function setDeployStatus(nodeId: string, status: DeployStatus): Promise<void> {
  deployProgress.set(nodeId, status);

  const store = getStateStore();
  if (store.kind !== 'redis') return Promise.resolve();
  return chainWrite(() => store.set(KEY_PREFIX + nodeId, JSON.stringify(status), REDIS_TTL_SECONDS));
}

export function clearDeployStatus(nodeId: string): Promise<void> {
  deployProgress.delete(nodeId);

  const store = getStateStore();
  if (store.kind !== 'redis') return Promise.resolve();
  return chainWrite(() => store.del(KEY_PREFIX + nodeId));
}
