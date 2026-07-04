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
    singBoxAccessible: boolean;
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
export type KernelType = 'sing-box' | 'xray' | 'v2ray';

/** 节点配置（来自 nodes.yaml） */
export interface NodeConfig {
  id: string;
  name: string;
  host: string;
  /** Agent HTTP 端口 */
  port?: number;
  secret: string;          // HMAC 共享密钥，localhost 可为空
  kernel: KernelType;
  location: string;
  enabled: boolean;
  /** SSH 连接配置（可选，用于远程部署） */
  ssh?: NodeSshConfig;
  /** Agent 运行时信息（系统维护） */
  agent?: NodeAgentInfo;
  /** 内核安装信息（系统维护） */
  kernelInfo?: NodeKernelInfo;
}

/** 单个节点的运行时状态 */
export interface NodeStatus {
  nodeId: string;
  name: string;
  kernel: KernelType;
  location: string;
  online: boolean;
  error?: string;           // 离线或异常原因
  latency?: number;         // 毫秒
  nodesCount?: number;      // 代理节点数
  subscriptionExists?: boolean;
  clashExists?: boolean;
  mihomoAvailable?: boolean;
  kernelAccessible?: boolean;
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
export interface NodeSshConfig {
  user: string;
  /** SSH 端口，默认 22 */
  port?: number;
  keyPath: string;
  hostKey: string;
  /** 密码认证（可选，优先使用 keyPath，keyPath 为空时使用密码） */
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
}

/** 内核安装信息 */
export interface NodeKernelInfo {
  installed: boolean;
  version: string;
  installScript: string;
}

/** 部署进度状态（单条当前状态，非历史数组） */
export interface DeployStatus {
  nodeId: string;
  step: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message: string;
  progress: number;
  startedAt: number;  // Date.now()，用于 TTL 清理
}
