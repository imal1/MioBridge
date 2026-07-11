export interface Config {
    port: number;
    singBoxConfigs: string[];
    mihomoPath: string;
    clashFilename: string;
    staticDir: string;
    logDir: string;
    backupDir: string;
    autoUpdateCron: string;
    nginxPort: number;
    maxRetries: number;
    requestTimeout: number;
}

export interface UpdateResult {
    success: boolean;
    message: string;
    timestamp: string;
    nodesCount: number;
    clashGenerated: boolean;
    backupCreated: string;
    warnings?: string[];
    errors?: string[];
}

export interface SingBoxResult {
    urls: string[];
    errors: string[];
}

export interface StatusInfo {
    subscriptionExists: boolean;
    clashExists: boolean;
    rawExists: boolean;
    mihomoAvailable: boolean;
    subscriptionLastUpdated?: string;
    subscriptionSize?: number;
    clashLastUpdated?: string;
    clashSize?: number;
    nodesCount?: number;
    uptime: number;
    version: string;
    mihomoVersion?: string;
    gitCommit?: string;
    buildTime?: string;
}

export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
    timestamp: string;
}

export interface LogsResult {
    file: string;
    files: string[];
    lines: string[];
    updatedAt: string;
    nodeId?: string;
    nodeName?: string;
}

export interface ConfigUpdateRequest {
    configs: string[];
}

export interface HealthStatus {
    status: 'healthy' | 'unhealthy';
    checks: {
        database: boolean;
        mihomo: boolean;
        filesystem: boolean;
        singbox: boolean;
    };
    timestamp: string;
}

// ==================== v1.0 多节点类型 ====================

/** 代理内核类型 */
export const KERNEL_TYPES = ['sing-box', 'xray', 'v2ray'] as const;
export type KernelType = typeof KERNEL_TYPES[number];

export interface NodeKernelConfig {
  type: KernelType;
  configPath?: string;
}

/** Agent 报告的单个内核运行时状态。须与 Agent KernelRuntimeStatus 保持一致。 */
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

export function validateKernelConfigs(
  kernels: unknown,
  options: { allowEmpty?: boolean } = {},
): NodeKernelConfig[] {
  if (!Array.isArray(kernels) || (!options.allowEmpty && kernels.length === 0)) {
    throw new Error('至少选择一个内核');
  }

  const seen = new Set<KernelType>();
  const normalized: NodeKernelConfig[] = [];
  for (const value of kernels) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('内核配置无效');
    }
    const candidate = value as Record<string, unknown>;
    const unknownKey = Object.keys(candidate).find(key => key !== 'type' && key !== 'configPath');
    if (unknownKey) {
      throw new Error(`内核配置包含未知字段: ${unknownKey}`);
    }
    const type = candidate.type;
    if (typeof type !== 'string' || !KERNEL_TYPES.includes(type as KernelType)) {
      throw new Error(`不支持的内核类型: ${typeof type === 'string' ? type : String(type ?? '')}`);
    }
    if (seen.has(type as KernelType)) {
      throw new Error(`内核类型重复: ${type}`);
    }
    if (candidate.configPath !== undefined &&
        (typeof candidate.configPath !== 'string' ||
         !/^\/[A-Za-z0-9/._@+-]+$/.test(candidate.configPath))) {
      throw new Error(`内核配置路径无效: ${type}`);
    }
    seen.add(type as KernelType);
    normalized.push({
      type: type as KernelType,
      ...(candidate.configPath !== undefined ? { configPath: candidate.configPath } : {}),
    });
  }

  return normalized.sort((a, b) => KERNEL_TYPES.indexOf(a.type) - KERNEL_TYPES.indexOf(b.type));
}

/** 节点配置（来自 nodes.yaml） */
export interface NodeConfig {
  id: string;
  name: string;
  host: string;
  /** Agent HTTP 端口 */
  port?: number;
  secret: string;          // HMAC 共享密钥，localhost 可为空
  kernels: NodeKernelConfig[];
  location: string;
  enabled: boolean;
  /** SSH 连接配置（可选，用于远程部署） */
  ssh?: NodeSshConfig;
  /** Agent 运行时信息（系统维护） */
  agent?: NodeAgentInfo;
}

/** 单个节点的运行时状态 */
export interface NodeStatus {
  nodeId: string;
  name: string;
  /** 主节点保存的期望内核配置；与 Agent 上报的运行时状态分离。 */
  configuredKernels: NodeKernelConfig[];
  kernels: KernelRuntimeStatus[];
  location: string;
  online: boolean;
  error?: string;           // 离线或异常原因
  latency?: number;         // 毫秒
  nodesCount?: number;      // 代理节点数
  subscriptionExists?: boolean;
  clashExists?: boolean;
  mihomoAvailable?: boolean;
  version?: string;
  uptime?: number;
  agent?: NodeAgentInfo;
}

/** 集群聚合状态 */
export interface ClusterStatus {
  totalNodes: number;
  onlineNodes: number;
  totalProxies: number;
  nodes: NodeStatus[];
  lastUpdated: string;
}

/** 内核适配器接口 */
export interface KernelAdapter {
  readonly type: KernelType;
  getConfigPaths(): Promise<string[]>;
  extractNodeUrls(): Promise<string[]>;
  isAvailable(): Promise<boolean>;
}

/** nodes.yaml 顶层结构 */
export interface NodesYaml {
  nodes: NodeConfig[];
}

// ==================== v1.0 Agent 部署类型 ====================

/** 节点 SSH 连接配置 */
export type SshAuthMethod = 'password' | 'privateKey';

export interface NodeSshConfig {
  user: string;
  /** SSH 端口，默认 22 */
  port?: number;
  authMethod: SshAuthMethod;
  /** StateStore 中独立保存的私钥引用 */
  credentialRef?: string;
  /** 旧版节点配置兼容字段，不再用于新部署 */
  keyPath?: string;
  hostKey: string;
  /** 仅 password 认证使用 */
  password?: string;
}

/** Agent 运行时信息 */
export interface NodeAgentInfo {
  deployed: boolean;
  version: string;
  status: 'not_deployed' | 'deploying' | 'running' | 'stopped' | 'error';
  lastDeploy: string;
  /** Agent HTTP 端口，默认 3001 */
  port?: number;
  /** 当前拥有节点部署写权限的 generation。 */
  deploymentId?: string;
}

/** 部署进度状态（单条当前状态，非历史数组） */
export interface DeployStatus {
  nodeId: string;
  deploymentId: string;
  step: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message: string;
  progress: number;
  startedAt: number;  // Date.now()，用于 TTL 清理
}
