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

async function writeStatus(nodeId: string, status: DeployStatus): Promise<void> {
  deployProgress.set(nodeId, status);
  const store = getStateStore();
  if (store.kind === 'redis') {
    await store.set(KEY_PREFIX + nodeId, JSON.stringify(status), REDIS_TTL_SECONDS);
  }
}

/** 新部署取得该节点的进度写权限。 */
export function beginDeployStatus(nodeId: string, status: DeployStatus): Promise<void> {
  const store = getStateStore();
  return store.withLock(KEY_PREFIX + nodeId, () => writeStatus(nodeId, status));
}

/** 只有仍为当前 generation 的部署可以更新进度。 */
export function setDeployStatusIfCurrent(
  nodeId: string,
  deploymentId: string,
  status: DeployStatus,
): Promise<boolean> {
  const store = getStateStore();
  return store.withLock(KEY_PREFIX + nodeId, async () => {
    let current = deployProgress.get(nodeId) || null;
    if (store.kind === 'redis') {
      const raw = await store.get(KEY_PREFIX + nodeId);
      current = raw ? JSON.parse(raw) as DeployStatus : null;
    }
    if (current?.deploymentId !== deploymentId) return false;
    await writeStatus(nodeId, status);
    return true;
  });
}

/** 兼容内部测试/调用：无条件开始一条新的状态。 */
export function setDeployStatus(nodeId: string, status: DeployStatus): Promise<void> {
  return beginDeployStatus(nodeId, status);
}

export function clearDeployStatus(nodeId: string): Promise<void> {
  const store = getStateStore();
  return store.withLock(KEY_PREFIX + nodeId, async () => {
    deployProgress.delete(nodeId);
    if (store.kind === 'redis') await store.del(KEY_PREFIX + nodeId);
  });
}
