import type { KernelType } from '../kernels/types.js';

export interface NodeKernelConfig { type: KernelType; configPath?: string }
export interface KernelRuntimeStatus {
  type: KernelType; detected: boolean; monitored: boolean; accessible: boolean;
  nodesCount: number; version?: string; configPaths: string[]; error?: string;
  /** Agent 实际解析到的可执行文件路径；旧版 Agent 不上报时留空。 */
  binaryPath?: string;
}
export interface NodeAgentInfo {
  deployed: boolean; version: string;
  status: 'not_deployed' | 'deploying' | 'running' | 'stopped' | 'error';
  lastDeploy: string; port?: number; deploymentId?: string;
  serviceMode?: 'user' | 'system'; runtimeUser?: string;
}
export interface NodeSshConfig {
  user: string; port?: number; authMethod: 'password' | 'privateKey';
  credentialRef?: string; keyPath?: string; hostKey: string; password?: string;
}
/** 订阅里可被节点出口设置改写的代理协议（分享链接 scheme；hy2 归入 hysteria2）。 */
export const NODE_PROXY_PROTOCOLS = ['vless', 'vmess', 'trojan', 'hysteria2', 'tuic', 'ss'] as const;
export type NodeProxyProtocol = typeof NODE_PROXY_PROTOCOLS[number];
/** strict = 客户端必须校验证书；insecure = 跳过校验（自签证书）。缺省沿用内核上报值。 */
export type NodeCertVerify = 'strict' | 'insecure';
/**
 * 节点在订阅产物中的出口设置。它只描述客户端如何连接代理，与 Agent 管理地址
 * （NodeConfig.host）无关：切换代理域名不会改动控制面的连接方式。
 * 每个字段都是显式选择，缺省即沿用内核上报值——绝不因为内核配置了 server_name
 * 就推断证书可信。
 */
export interface NodeProxyConfig {
  /** 客户端连接地址（域名或 IP），替换内核导出的地址。 */
  server?: string;
  /** TLS server name / SNI。Reality 与非 TLS 协议不受影响。 */
  sni?: string;
  certVerify?: NodeCertVerify;
  /** server / sni / certVerify 生效的协议范围；缺省对该节点全部协议生效。 */
  protocols?: NodeProxyProtocol[];
  /** 订阅中的显示名称；设置后节点导出为「显示名称 + 协议」。 */
  displayName?: string;
}
export interface NodeConfig {
  id: string; name: string; host: string; port?: number; secret: string;
  kernels: NodeKernelConfig[]; location: string; enabled: boolean; tags?: string[];
  ssh?: NodeSshConfig; agent?: NodeAgentInfo; proxy?: NodeProxyConfig;
}
export type NodeHealth = 'online' | 'fluctuating' | 'abnormal' | 'offline';
export const NODE_HEALTH_THRESHOLDS = { abnormalFailures: 3, offlineFailures: 5, recoverySuccesses: 2 } as const;
export interface NodeStatus {
  sourceCached?: boolean;
  sourceCollectedAt?: string;
  nodeId: string; name: string; configuredKernels: NodeKernelConfig[];
  kernels: KernelRuntimeStatus[]; location: string; online: boolean; error?: string;
  /** online remains true until offline is confirmed; health distinguishes current alerts. */
  health?: NodeHealth;
  consecutiveFailures?: number;
  consecutiveSuccesses?: number;
  /** 最近一次观察到的失败原因，节点恢复在线后依然保留，用于进入排障链路。 */
  lastError?: string;
  lastErrorAt?: string;
  host?: string; enabled?: boolean; tags?: string[]; sshUser?: string; sshPort?: number; sshHostKey?: string;
  /** 认证方式本身不是凭据，必须暴露：否则编辑界面无从得知现状，只能猜。 */
  sshAuthMethod?: NodeSshConfig['authMethod'];
  latency?: number; nodesCount?: number; subscriptionExists?: boolean;
  clashExists?: boolean; mihomoAvailable?: boolean; mihomoVersion?: string; version?: string;
  uptime?: number; agent?: NodeAgentInfo;
  /** Agent 打通后检测到、但当前未纳入监控的已装内核。前端据此提示用户确认纳管。 */
  adoptableKernels?: KernelType[];
  /** 订阅出口设置不是凭据，原样回传供编辑界面展示现状。 */
  proxy?: NodeProxyConfig;
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
