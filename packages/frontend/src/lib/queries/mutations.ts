import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiService } from '@/lib/api'
import type { DeployComponent, DeployOperation, KernelType, NodeKernelConfig, SubscriptionPolicy } from '@/lib/types'
import { queryKeys } from './keys'

function invalidate(qc: QueryClient, keys: readonly unknown[][]) {
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey })
}

// ---- Node writes → cluster status ----
export function useUpdateNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { nodeId: string; patch: Parameters<typeof apiService.updateNode>[1] }) =>
      apiService.updateNode(vars.nodeId, vars.patch),
    onSuccess: () => invalidate(qc, [queryKeys.clusterStatus]),
  })
}

export function useDeleteNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { nodeId: string; force?: boolean }) => apiService.deleteNode(vars.nodeId, vars.force),
    onSuccess: () => invalidate(qc, [queryKeys.clusterStatus]),
  })
}

export function useAddNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof apiService.addNode>[0]) => apiService.addNode(data),
    onSuccess: () => invalidate(qc, [queryKeys.clusterStatus]),
  })
}

export function useUpdateNodeKernels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { nodeId: string; kernels: NodeKernelConfig[] }) =>
      apiService.updateNodeKernels(vars.nodeId, vars.kernels),
    onSuccess: () => invalidate(qc, [queryKeys.clusterStatus, queryKeys.componentStates()]),
  })
}

// ---- Agent actions → cluster status ----
export function useAgentAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { nodeId: string; action: 'start' | 'stop' | 'restart' }) =>
      vars.action === 'start' ? apiService.startAgent(vars.nodeId)
        : vars.action === 'stop' ? apiService.stopAgent(vars.nodeId)
          : apiService.restartAgent(vars.nodeId),
    onSuccess: () => invalidate(qc, [queryKeys.clusterStatus]),
  })
}

export function useClusterHealthCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (nodeId?: string) => apiService.clusterHealthCheck(nodeId),
    onSuccess: () => invalidate(qc, [queryKeys.clusterStatus]),
  })
}

// ---- Kernel → component states + cluster ----
export function useKernelAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { nodeId: string; kernelType: KernelType; action: 'start' | 'stop' | 'restart' }) =>
      apiService.kernelAction(vars.nodeId, vars.kernelType, vars.action),
    onSuccess: () => invalidate(qc, [queryKeys.componentStates(), queryKeys.clusterStatus]),
  })
}

// ---- Deploy → deployments + component states ----
export function useStartDeployment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      nodeId: string; component: DeployComponent; operation: DeployOperation
      options?: { preserveConfig: boolean; preserveData: boolean }
    }) => apiService.startComponentDeployment(vars.nodeId, vars.component, vars.operation, vars.options),
    onSuccess: () => invalidate(qc, [queryKeys.componentDeployments(), queryKeys.componentStates()]),
  })
}

export function useRetryDeployment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) => apiService.retryComponentDeployment(taskId),
    onSuccess: () => invalidate(qc, [queryKeys.componentDeployments()]),
  })
}

export function useCancelDeployment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) => apiService.cancelComponentDeployment(taskId),
    onSuccess: () => invalidate(qc, [queryKeys.componentDeployments()]),
  })
}

// ---- Subscription ----
export function useStartSubscriptionJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiService.startSubscriptionJob(),
    onSuccess: () => invalidate(qc, [queryKeys.subscriptionJobs]),
  })
}

export function useRetrySubscriptionJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => apiService.retrySubscriptionJob(jobId),
    onSuccess: () => invalidate(qc, [queryKeys.subscriptionJobs]),
  })
}

export function useUpdateSubscriptionPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (policy: SubscriptionPolicy) => apiService.updateSubscriptionPolicy(policy),
    onSuccess: () => invalidate(qc, [queryKeys.subscriptionPolicy]),
  })
}

// ---- Config ----
export function usePatchConfigValues() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (changes: Array<{ path: string; value: unknown }>) => apiService.patchConfigValues(changes),
    onSuccess: () => invalidate(qc, [queryKeys.effectiveConfig]),
  })
}

export function useRestoreConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiService.restoreConfig(),
    onSuccess: () => invalidate(qc, [queryKeys.effectiveConfig]),
  })
}

// ---- Outputs ----
export function useValidateArtifacts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name?: Parameters<typeof apiService.validateArtifacts>[0]) => apiService.validateArtifacts(name),
    onSuccess: () => invalidate(qc, [queryKeys.artifacts]),
  })
}

// ---- Subscription update (actions page) ----
export function useUpdateSubscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiService.updateSubscription(),
    onSuccess: () => invalidate(qc, [queryKeys.status, queryKeys.clusterStatus]),
  })
}
