import type { KernelType } from '../kernels/types.js';

export interface NodeKernelConfig { type: KernelType; configPath?: string }
export interface KernelRuntimeStatus {
  type: KernelType; detected: boolean; monitored: boolean; accessible: boolean;
  nodesCount: number; version?: string; configPaths: string[]; error?: string;
}
export interface NodeAgentInfo {
  deployed: boolean; version: string;
  status: 'not_deployed' | 'deploying' | 'running' | 'stopped' | 'error';
  lastDeploy: string; port?: number; deploymentId?: string;
}
export interface NodeSshConfig {
  user: string; port?: number; authMethod: 'password' | 'privateKey';
  credentialRef?: string; keyPath?: string; hostKey: string; password?: string;
}
export interface NodeConfig {
  id: string; name: string; host: string; port?: number; secret: string;
  kernels: NodeKernelConfig[]; location: string; enabled: boolean; tags?: string[];
  ssh?: NodeSshConfig; agent?: NodeAgentInfo;
}
export interface NodeStatus {
  nodeId: string; name: string; configuredKernels: NodeKernelConfig[];
  kernels: KernelRuntimeStatus[]; location: string; online: boolean; error?: string;
  host?: string; enabled?: boolean; tags?: string[]; sshUser?: string; sshPort?: number; sshHostKey?: string;
  latency?: number; nodesCount?: number; subscriptionExists?: boolean;
  clashExists?: boolean; mihomoAvailable?: boolean; mihomoVersion?: string; version?: string;
  uptime?: number; agent?: NodeAgentInfo;
}
export interface ClusterStatus {
  totalNodes: number; onlineNodes: number; totalProxies: number;
  nodes: NodeStatus[]; lastUpdated: string;
}
export interface LogsResult {
  file: string; files: string[]; lines: unknown[]; updatedAt: string;
  nodeId: string; nodeName: string;
}
export interface NodeLogger {
  info(message: string): void; warn(message: string): void; error(message: string): void;
}
