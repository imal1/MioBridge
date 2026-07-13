import { useState, useEffect, useRef } from 'react';
import type { ClusterStatus } from '@/lib/types';

/**
 * React Hook: 使用 SSE 获取集群状态实时更新
 * @param initialData - SSR 首屏数据（来自 getServerSideProps）
 * @returns 实时更新的 ClusterStatus
 */
export function useClusterSSE(initialData: ClusterStatus | null): ClusterStatus | null {
  const [cluster, setCluster] = useState<ClusterStatus | null>(initialData);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/cluster/events');
    esRef.current = es;

    es.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as ClusterStatus;
        setCluster(data);
      } catch {
        // ignore malformed SSE data
      }
    };

    return () => {
      es.close();
    };
  }, []);

  return cluster;
}
