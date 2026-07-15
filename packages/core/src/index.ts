/** Framework-neutral logging port used by core services. */
export interface CoreLogger {
  debug(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  info(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  warn(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  error(message: string, metadata?: Readonly<Record<string, unknown>>): void;
}

/** Package identity for headless-runtime and tracing probes. */
export const CORE_PACKAGE_NAME = '@miobridge/core' as const;

export { ConfigService } from './config/configService.js';
export { YamlService, type YamlServiceOptions } from './config/yamlService.js';
export {
  createRuntimePaths,
  type RuntimeEnvironment,
  type RuntimePaths,
  type RuntimePathsOptions,
} from './runtime/runtimePaths.js';
export {
  createStateStore,
  FileStateStore,
  RedisStateStore,
  type StateStore,
  type StateStoreOptions,
} from './state/stateStore.js';
export type {
  ActorRole, Config, ConfigApplyResult, ConfigFieldDefinition, ConfigValidationIssue,
  ConfigValidationResult, DeploymentPolicyConfig, FullConfig, NotificationWebhookConfig,
  SubscriptionPolicyConfig,
} from './types/config.js';
export { LocalLogService, type LocalLogEntry, type LocalLogQuery, type LocalLogResult } from './logs/localLogService.js';
export { MetricsService, type ArtifactMetric, type ClusterMetricsSource, type MetricsSnapshot } from './metrics/metricsService.js';
export { buildClashSubscription, buildClashSubscriptionResult, dedupeProxySources, type ClashSubscriptionResult, type CollectedProxySource } from './artifacts/sources.js';
export { SingBoxAdapter, type SingBoxAdapterOptions } from './kernels/singBoxAdapter.js';
export { MihomoAdapter, type MihomoAdapterOptions } from './kernels/mihomoAdapter.js';
export { V2rayAdapter, XrayAdapter } from './kernels/jsonOutboundAdapters.js';
export { KERNEL_TYPES, type KernelAdapter, type KernelType } from './kernels/types.js';
export type { KernelFileSystem, ProcessOptions, ProcessResult, ProcessRunner } from './kernels/ports.js';
export { AgentClient, type AgentClientOptions } from './nodes/agentClient.js';
export { NodeRepository, validateNodeKernels } from './nodes/nodeRepository.js';
export { NodeAggregationService, type RemoteSourceCollection } from './nodes/nodeAggregationService.js';
export type { ClusterStatus, KernelRuntimeStatus, LogsResult, NodeAgentInfo, NodeConfig, NodeKernelConfig, NodeSshConfig, NodeStatus } from './nodes/types.js';
export { ArtifactService, type ArtifactServiceOptions, type ClashConverter, type LocalSourceCollector, type RemoteSourceCollector, type SourceCollection, type SubscriptionPreflight, type UpdateResult } from './artifacts/artifactService.js';
export { StatusService, type BuildMetadata, type StatusInfo, type StatusKernel, type StatusServiceOptions } from './status/statusService.js';
export { MioBridgeCore, type MioBridgeCoreOptions } from './mioBridgeCore.js';
