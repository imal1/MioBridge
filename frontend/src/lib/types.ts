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
  ssh?: NodeSshConfig;
  agent?: NodeAgentInfo;
}

/** Runtime status of a single node */
export interface NodeStatus {
  nodeId: string;
  name: string;
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
  step: 'connect' | 'bun' | 'kernel' | 'agent' | 'start' | 'verify' | 'done';
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
