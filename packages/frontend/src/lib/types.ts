// Browser-safe type definitions — no Node/server imports.
// These types mirror the server-side shapes consumed by the SPA.

/** Proxy kernel type */
export const KERNEL_TYPES = ['sing-box', 'xray', 'v2ray'] as const;
export type KernelType = typeof KERNEL_TYPES[number];

export interface NodeKernelConfig {
  type: KernelType;
  configPath?: string;
}

/** Agent-reported runtime status for a single kernel */
export interface KernelRuntimeStatus {
  type: KernelType;
  detected: boolean;
  monitored: boolean;
  accessible: boolean;
  nodesCount: number;
  version?: string;
  configPaths: string[];
  error?: string;
}

export type SshAuthMethod = 'password' | 'privateKey';

export interface NodeSshConfig {
  user: string;
  port?: number;
  authMethod: SshAuthMethod;
  credentialRef?: string;
  keyPath?: string;
  hostKey: string;
  password?: string;
}

export interface NodeAgentInfo {
  deployed: boolean;
  version: string;
  status: 'not_deployed' | 'deploying' | 'running' | 'stopped' | 'error';
  lastDeploy: string;
  port?: number;
  deploymentId?: string;
}

/** Node config from nodes.yaml */
export interface NodeConfig {
  id: string;
  name: string;
  host: string;
  port?: number;
  secret: string;
  kernels: NodeKernelConfig[];
  location: string;
  enabled: boolean;
  tags?: string[];
  ssh?: NodeSshConfig;
  agent?: NodeAgentInfo;
}

/** Runtime status of a single node */
export interface NodeStatus {
  nodeId: string;
  name: string;
  host?: string;
  enabled?: boolean;
  tags?: string[];
  sshUser?: string;
  sshPort?: number;
  sshHostKey?: string;
  configuredKernels: NodeKernelConfig[];
  kernels: KernelRuntimeStatus[];
  location: string;
  online: boolean;
  error?: string;
  latency?: number;
  nodesCount?: number;
  subscriptionExists?: boolean;
  clashExists?: boolean;
  mihomoAvailable?: boolean;
  mihomoVersion?: string;
  version?: string;
  uptime?: number;
  agent?: NodeAgentInfo;
}

/** Cluster aggregate status */
export interface ClusterStatus {
  totalNodes: number;
  onlineNodes: number;
  totalProxies: number;
  nodes: NodeStatus[];
  lastUpdated: string;
}

/** Deploy progress status (single current state) */
export interface DeployStatus {
  nodeId: string;
  deploymentId: string;
  step: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message: string;
  progress: number;
  startedAt: number;
}

export type DeployComponent = 'agent' | 'mihomo' | KernelType;
export type DeployOperation = 'install' | 'reinstall' | 'upgrade' | 'repair' | 'uninstall';

export interface ComponentDeployStatus {
  taskId: string;
  idempotencyKey: string;
  nodeId: string;
  component: DeployComponent;
  operation: DeployOperation;
  step: 'queued' | 'prechecking' | 'downloading' | 'verifying_package' | 'installing' | 'configuring' | 'restarting' | 'postchecking' | 'done';
  status: 'pending' | 'running' | 'success' | 'error' | 'cancelled';
  message: string;
  progress: number;
  actorRole: 'admin' | 'operator' | 'viewer';
  options: { preserveConfig: boolean; preserveData: boolean };
  createdAt: string;
  startedAt: number;
  finishedAt?: number;
  beforeVersion?: string;
  afterVersion?: string;
  retryOf?: string;
  errorCode?: string;
}

export interface ComponentState {
  nodeId: string;
  component: DeployComponent;
  installState: 'unknown' | 'not_installed' | 'installing' | 'installed' | 'upgrading' | 'uninstalling' | 'failed';
  runtimeState: 'unknown' | 'running' | 'stopped' | 'degraded' | 'error' | 'not_applicable';
  monitorState: 'not_configured' | 'monitored' | 'unmonitored' | 'error' | 'not_applicable';
  version?: string;
  path?: string;
  configPath?: string;
  sources?: number;
  lastTaskId?: string;
  error?: string;
}

export interface SubscriptionPreflight {
  ready: boolean;
  sourcesTotal: number;
  nodesEstimated: number;
  warnings: string[];
  blockingErrors: string[];
}

export interface SubscriptionJob {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
  step: 'collect' | 'parse' | 'deduplicate' | 'encode' | 'convert' | 'validate' | 'publish' | 'backup' | 'done';
  progress: number;
  message: string;
  sourcesTotal: number;
  sourcesSucceeded: number;
  nodesGenerated: number;
  warnings: string[];
  errors: string[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  retryOf?: string;
  backupId?: string;
}

export interface ArtifactState {
  name: 'raw.txt' | 'subscription.txt' | 'clash.yaml';
  exists: boolean;
  valid: boolean;
  size: number;
  updatedAt?: string;
  ageSeconds?: number;
  freshness: 'fresh' | 'expiring' | 'stale' | 'invalid';
  validationError?: string;
}

export interface SubscriptionPolicy {
  enabled: boolean;
  cron: string;
  freshnessHours: number;
  nodeDropPercent: number;
  retryDelaysMinutes: number[];
  backupRetention: number;
}

export interface MetricsSnapshot {
  timestamp: string;
  version: string;
  uptime: number;
  enabledNodes: number;
  onlineNodes: number;
  sources: number;
  proxies: number;
  mihomoAvailable: boolean;
  artifacts: Record<'raw' | 'subscription' | 'clash', { exists: boolean; ageSeconds?: number; size?: number }>;
  lastGeneration?: { status: 'success' | 'partial' | 'failed'; timestamp: string; durationMs?: number };
}

export interface MetricsSummary {
  deploymentSuccessRate: number | null;
  deploymentCompleted: number;
  deploymentAverageDurationMs: number | null;
  deploymentStepAverageDurationMs: Record<string, number | null>;
  agentOnlineRate: number | null;
  sourceSuccessRate: number | null;
  subscriptionSuccessRate: number | null;
  subscriptionJobs: number;
  artifactAverageAgeSeconds: number | null;
  artifactMaximumAgeSeconds: number | null;
}

/** Kernel detection result from SSH deploy */
export interface KernelDetection {
  type: KernelType;
  installed: boolean;
  defaultConfigPath: string;
  version?: string;
  error?: string;
}

export interface KernelDeployResult extends KernelDetection {
  installedNow: boolean;
}

export interface DeployStep {
  step: 'connect' | 'kernel' | 'agent' | 'start' | 'verify' | 'done';
  status: 'pending' | 'running' | 'success' | 'error';
  message: string;
  progress: number;
}

export interface AgentStatus {
  deployed: boolean;
  version: string;
  status: NodeAgentInfo['status'];
  lastDeploy: string;
  bunVersion: string;
  kernelVersion: string;
}

export interface DeployTarget {
  nodeId: string;
  secret: string;
  agentPort?: number;
  ssh: {
    host: string;
    user: string;
    port?: number;
    authMethod: SshAuthMethod;
    hostKey: string;
    password?: string;
    privateKey?: string;
  };
  kernels: NodeKernelConfig[];
}
