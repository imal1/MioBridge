import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { apiService } from '@/lib/api'
import { queryKeys } from './keys'
import type {
  ArtifactState, ClusterStatus, ComponentDeployStatus, ComponentState,
  MetricsSnapshot, MetricsSummary, SubscriptionJob, SubscriptionPolicy, SubscriptionPreflight,
} from '@/lib/types'

// 服务端统一返回 { success, data, error }。data 缺失或 success:false 时抛错，
// 交给 <QueryBoundary> 渲染内联错误卡（而非静默落空列表）。
function unwrap<T>(res: { success: boolean; data?: T; error?: unknown }): T {
  if (!res.success || res.data === undefined) {
    const reason = res.error
    const message = typeof reason === 'string' && reason.trim()
      ? reason
      : reason && typeof reason === 'object' && typeof (reason as { message?: unknown }).message === 'string'
        ? (reason as { message: string }).message
        : '请求失败'
    throw new Error(message)
  }
  return res.data
}

// 轮询/按需页面通过 options 覆盖 refetchInterval、enabled 等。
type Extra<T> = Partial<Omit<UseQueryOptions<T, Error, T>, 'queryKey' | 'queryFn'>>

export function useClusterStatus(options?: Extra<ClusterStatus>) {
  return useQuery({
    queryKey: queryKeys.clusterStatus,
    queryFn: async () => unwrap<ClusterStatus>(await apiService.getClusterStatus()),
    ...options,
  })
}

export function useStatus(options?: Extra<Awaited<ReturnType<typeof apiService.getStatus>>>) {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: () => apiService.getStatus(),
    ...options,
  })
}

type MetricsData = { snapshot: MetricsSnapshot; history: MetricsSnapshot[]; summary: MetricsSummary }
export function useMetrics(range: '24h' | '7d' | '30d', options?: Extra<MetricsData>) {
  return useQuery({
    queryKey: queryKeys.metrics(range),
    queryFn: async () => {
      const data = unwrap(await apiService.getMetrics(range))
      return { snapshot: data.snapshot, history: data.history, summary: data.summary }
    },
    ...options,
  })
}

export function useComponentStates(nodeIds?: string[], options?: Extra<ComponentState[]>) {
  return useQuery({
    queryKey: queryKeys.componentStates(nodeIds),
    queryFn: async () => unwrap(await apiService.getComponentStates(nodeIds)).states,
    ...options,
  })
}

export function useComponentDeployments(nodeIds?: string[], options?: Extra<Record<string, ComponentDeployStatus>>) {
  return useQuery({
    queryKey: queryKeys.componentDeployments(nodeIds),
    queryFn: async () => unwrap(await apiService.getComponentDeployments(nodeIds)).deployments,
    ...options,
  })
}

export function useSubscriptionJobs(options?: Extra<SubscriptionJob[]>) {
  return useQuery({
    queryKey: queryKeys.subscriptionJobs,
    queryFn: async () => unwrap(await apiService.getSubscriptionJobs()).jobs,
    ...options,
  })
}

export function useSubscriptionPolicy(options?: Extra<SubscriptionPolicy>) {
  return useQuery({
    queryKey: queryKeys.subscriptionPolicy,
    queryFn: async () => unwrap<SubscriptionPolicy>(await apiService.getSubscriptionPolicy()),
    ...options,
  })
}

export function useSubscriptionPreflight(options?: Extra<SubscriptionPreflight>) {
  return useQuery({
    queryKey: queryKeys.subscriptionPreflight,
    queryFn: async () => unwrap<SubscriptionPreflight>(await apiService.preflightSubscription()),
    ...options,
  })
}

export function useArtifacts(options?: Extra<ArtifactState[]>) {
  return useQuery({
    queryKey: queryKeys.artifacts,
    queryFn: async () => unwrap(await apiService.getArtifacts()).artifacts,
    ...options,
  })
}

type SchemaField = { path: string; type: string; restartRequired: boolean; minimum?: number; maximum?: number; allowed?: string[] }
export function useConfigSchema(options?: Extra<SchemaField[]>) {
  return useQuery({
    queryKey: queryKeys.configSchema,
    queryFn: async () => unwrap(await apiService.getConfigSchema()).fields,
    ...options,
  })
}

type EffectiveConfig = { config: Record<string, unknown>; path: string }
export function useEffectiveConfig(options?: Extra<EffectiveConfig>) {
  return useQuery({
    queryKey: queryKeys.effectiveConfig,
    queryFn: async () => unwrap<EffectiveConfig>(await apiService.getEffectiveConfig()),
    ...options,
  })
}

type NotificationRecord = { id: string; event: string; ok: boolean; statusCode: number; timestamp: string }
export function useNotificationHistory(options?: Extra<NotificationRecord[]>) {
  return useQuery({
    queryKey: queryKeys.notificationHistory,
    queryFn: async () => unwrap(await apiService.getNotificationHistory()).records,
    ...options,
  })
}

export function useOpenApi(options?: Extra<unknown>) {
  return useQuery({
    queryKey: queryKeys.openApi,
    queryFn: () => apiService.getOpenApi(),
    ...options,
  })
}

type LogsArgs = Parameters<typeof apiService.getLogs>
export function useLogs(args: LogsArgs, options?: Extra<Awaited<ReturnType<typeof apiService.getLogs>>['data']>) {
  return useQuery({
    queryKey: queryKeys.logs(JSON.stringify(args)),
    queryFn: async () => unwrap(await apiService.getLogs(...args)),
    ...options,
  })
}

export { queryKeys } from './keys'
export * from './mutations'
