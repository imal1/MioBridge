import ky, { HTTPError } from 'ky';
import type { KernelDetection } from '@/server/services/deployManager';
import { KERNEL_TYPES, type KernelType, type NodeConfig, type NodeKernelConfig, type SshAuthMethod } from '@/server/types';

export type DetectKernelsPayload =
  | { nodeId: string }
  | {
      ssh: {
        host: string;
        user: string;
        port?: number;
        authMethod: SshAuthMethod;
        hostKey?: string;
        password?: string;
        privateKey?: string;
      };
    };

export const API_RETRY_METHODS = ['get'] as const;
const KERNEL_DETECTION_FIELDS = new Set(['type', 'installed', 'version', 'defaultConfigPath', 'error']);

export function validateKernelDetections(value: unknown): KernelDetection[] {
  if (!Array.isArray(value) || value.length !== KERNEL_TYPES.length) {
    throw new Error('内核检测响应无效');
  }
  const byType = new Map<KernelType, KernelDetection>();
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('内核检测响应无效');
    const candidate = item as Record<string, unknown>;
    const type = candidate.type;
    if (Object.keys(candidate).some(key => !KERNEL_DETECTION_FIELDS.has(key)) ||
        typeof type !== 'string' || !KERNEL_TYPES.includes(type as KernelType) || byType.has(type as KernelType) ||
        typeof candidate.installed !== 'boolean' || typeof candidate.defaultConfigPath !== 'string' ||
        !candidate.defaultConfigPath.startsWith('/') ||
        (candidate.version !== undefined && typeof candidate.version !== 'string') ||
        (candidate.error !== undefined && typeof candidate.error !== 'string')) {
      throw new Error('内核检测响应无效');
    }
    byType.set(type as KernelType, {
      type: type as KernelType,
      installed: candidate.installed,
      defaultConfigPath: candidate.defaultConfigPath,
      ...(candidate.version !== undefined ? { version: candidate.version as string } : {}),
      ...(candidate.error !== undefined ? { error: candidate.error as string } : {}),
    });
  }
  return KERNEL_TYPES.map(type => {
    const detection = byType.get(type);
    if (!detection) throw new Error('内核检测响应无效');
    return detection;
  });
}

const API_BASE_URL =
  process.env.NODE_ENV === "production"
    ? "" // 在生产环境中使用相对路径
    : "http://localhost:3001"; // 开发环境中使用 next dev 地址

// 创建 ky 实例
const apiClient = ky.create({
  prefixUrl: API_BASE_URL,
  timeout: 30000,
  retry: {
    limit: 3,
    methods: [...API_RETRY_METHODS],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
  },
  hooks: {
    beforeError: [
      (error) => {
        console.error('API 请求失败:', error);
        return error;
      }
    ]
  }
});

export interface ApiStatus {
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

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

export interface ConvertResult {
  success: boolean;
  data?: {
    clashConfig: string;
    originalLength: number;
    configLength: number;
  };
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

// 自定义错误类
export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public data?: any
  ) {
    super(`API Error ${status}: ${statusText}`);
    this.name = 'ApiError';
  }
}

class ApiService {
  // 处理 API 错误
  private async handleError(error: unknown): Promise<never> {
    if (error instanceof HTTPError) {
      const status = error.response.status;
      const statusText = error.response.statusText;
      
      let errorData;
      try {
        errorData = await error.response.json();
      } catch {
        errorData = null;
      }

      throw new ApiError(status, statusText, errorData);
    }

    throw error;
  }

  // 获取API状态
  async getStatus(): Promise<ApiStatus> {
    try {
      const response = await apiClient.get('api/status').json<ApiResponse<ApiStatus>>();
      return response.data as ApiStatus;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // 更新订阅
  async updateSubscription(): Promise<UpdateResult> {
    try {
      const response = await apiClient.get('api/update').json<ApiResponse<UpdateResult>>();
      return response.data as UpdateResult;
    } catch (error) {
      return this.handleError(error);
    }
  }

  // 获取健康状态
  async getHealth(): Promise<{ status: string; timestamp: string }> {
    try {
      return await apiClient.get('health').json();
    } catch (error) {
      return this.handleError(error);
    }
  }

  // 获取配置列表
  async getConfigs(): Promise<string[]> {
    try {
      const response = await apiClient.get('api/configs').json<ApiResponse<string[] | { configs: string[] }>>();
      const data = response.data;
      return Array.isArray(data) ? data : data?.configs || [];
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updateConfigs(configs: string[]): Promise<ApiResponse<{ configs: string[]; count: number }>> {
    try {
      return await apiClient.post('api/configs', { json: { configs } }).json<ApiResponse<{ configs: string[]; count: number }>>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getFrontendConfig(): Promise<ApiResponse> {
    try {
      return await apiClient.get('api/yaml/frontend').json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getLogs(nodeId?: string, file?: string, level?: string, query?: string): Promise<ApiResponse<LogsResult>> {
    try {
      const params = new URLSearchParams();
      if (nodeId) params.set('node', nodeId);
      if (file) params.set('file', file);
      if (level && level !== 'all') params.set('level', level);
      if (query) params.set('q', query);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      return await apiClient.get(`api/logs${suffix}`).json<ApiResponse<LogsResult>>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  // 诊断Clash生成
  async diagnoseClash(): Promise<any> {
    try {
      return await apiClient.get('api/diagnose/clash').json();
    } catch (error) {
      return this.handleError(error);
    }
  }

  // 下载文件URL生成器
  getDownloadUrl(filename: string): string {
    return `${API_BASE_URL}/${filename}`;
  }

  // 转换订阅内容为Clash配置
  async convertContent(content: string): Promise<ConvertResult> {
    try {
      return await apiClient.post('api/convert', { json: { content } }).json<ConvertResult>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  // 获取集群状态
  async getClusterStatus(): Promise<ApiResponse> {
    try {
      return await apiClient.get('api/cluster/status').json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  // 触发集群更新
  async triggerClusterUpdate(nodeId?: string): Promise<ApiResponse> {
    try {
      const query = nodeId ? `?node=${encodeURIComponent(nodeId)}` : '';
      return await apiClient.post(`api/cluster/update${query}`).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  // 集群健康检查
  async clusterHealthCheck(nodeId?: string): Promise<ApiResponse> {
    try {
      const params = nodeId ? `?node=${encodeURIComponent(nodeId)}` : '';
      return await apiClient.get(`api/cluster/health${params}`).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  // 部署节点
  async deployNode(nodeId: string, kernels?: NodeKernelConfig[]): Promise<ApiResponse> {
    try {
      return await apiClient.post('api/cluster/deploy', { json: { nodeId, ...(kernels ? { kernels } : {}) } }).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  // 添加节点
  async addNode(data: {
    name: string;
    host: string;
    kernels: NodeKernelConfig[];
    location: string;
    sshUser: string;
    sshAuthMethod: SshAuthMethod;
    sshPassword?: string;
    sshPrivateKey?: string;
    sshPrivateKeyName?: string;
  }): Promise<ApiResponse<NodeConfig>> {
    try {
      return await apiClient.post('api/cluster/nodes', { json: data }).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async detectKernels(payload: DetectKernelsPayload): Promise<KernelDetection[]> {
    try {
      const response = await apiClient.post('api/cluster/kernel/detect', { json: payload }).json<ApiResponse<KernelDetection[]>>();
      if (!response.success || !response.data) throw new Error(response.error || '内核检测失败');
      return validateKernelDetections(response.data);
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updateNodeKernels(nodeId: string, kernels: NodeKernelConfig[]): Promise<ApiResponse<NodeConfig>> {
    try {
      return await apiClient.put('api/cluster/nodes', { json: { nodeId, kernels } }).json<ApiResponse<NodeConfig>>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  // 获取部署进度（聚合轮询，替代旧 SSE）
  async getDeployStatus(nodeId?: string): Promise<ApiResponse> {
    try {
      const url = nodeId
        ? `api/cluster/deploy/status?nodes=${encodeURIComponent(nodeId)}`
        : 'api/cluster/deploy/status';
      return await apiClient.get(url).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  // 获取单个节点部署进度（兼容旧接口）
  async getDeployProgress(nodeId: string): Promise<ApiResponse> {
    try {
      return await apiClient.get(`api/cluster/deploy/progress?node=${encodeURIComponent(nodeId)}`).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  // Agent 管理
  async updateAgent(nodeId: string): Promise<ApiResponse> {
    try {
      return await apiClient.post('api/cluster/agent/update', { json: { nodeId } }).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async uninstallAgent(nodeId: string): Promise<ApiResponse> {
    try {
      return await apiClient.post('api/cluster/agent/uninstall', { json: { nodeId } }).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async restartAgent(nodeId: string): Promise<ApiResponse> {
    try {
      return await apiClient.post('api/cluster/agent/restart', { json: { nodeId } }).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async stopAgent(nodeId: string): Promise<ApiResponse> {
    try {
      return await apiClient.post('api/cluster/agent/stop', { json: { nodeId } }).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async startAgent(nodeId: string): Promise<ApiResponse> {
    try {
      return await apiClient.post('api/cluster/agent/start', { json: { nodeId } }).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  // 内核管理
  async installKernel(nodeId: string, kernelType: string): Promise<ApiResponse> {
    try {
      return await apiClient.post('api/cluster/kernel/install', { json: { nodeId, kernelType } }).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async uninstallKernel(nodeId: string, kernelType: string): Promise<ApiResponse> {
    try {
      return await apiClient.post('api/cluster/kernel/uninstall', { json: { nodeId, kernelType } }).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }
}

export const apiService = new ApiService();
