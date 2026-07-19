import ky, { HTTPError } from 'ky';
import { KERNEL_TYPES, type ArtifactState, type ComponentDeployStatus, type ComponentState, type DeployComponent, type DeployOperation, type KernelDetection, type KernelType, type MetricsSnapshot, type MetricsSummary, type NodeConfig, type NodeKernelConfig, type SshAuthMethod, type SubscriptionJob, type SubscriptionPolicy, type SubscriptionPreflight } from '@/lib/types';
import type { FrontendConfig } from '@/lib/configApi';

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

// Vite development proxies these same-origin paths to the CLI dashboard server.
const API_BASE_URL = '';

function createIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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
  error?: any;
  message?: string;
  timestamp: string;
  requestId?: string;
  role?: 'admin';
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

export interface NodePreflightResult {
  hostKey: string;
  architecture: string;
  checks: Array<{ key: string; label: string; ok: boolean; detail: string }>;
}

// 服务端统一返回 { success: false, error: string | { message } }；
// 这里把它取出来当作 Error.message，否则界面只能显示无信息量的状态行。
function serverErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const reason = (data as { error?: unknown }).error;
  if (typeof reason === 'string' && reason.trim()) return reason;
  if (reason && typeof reason === 'object') {
    const message = (reason as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return null;
}

// 自定义错误类
export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public data?: any
  ) {
    super(serverErrorMessage(data) ?? `API Error ${status}: ${statusText}`);
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

  async getFrontendConfig(): Promise<ApiResponse<FrontendConfig>> {
    try {
      return await apiClient.get('api/yaml/frontend').json<ApiResponse<FrontendConfig>>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async validateConfig(): Promise<ApiResponse<unknown>> {
    try {
      return await apiClient.get('api/yaml/validate').json<ApiResponse<unknown>>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getLogs(
    nodeId?: string, file?: string, level?: string, query?: string,
    filters: { source?: 'control' | 'agent' | 'deployment' | 'subscription'; component?: string; taskId?: string; from?: string; to?: string } = {},
  ): Promise<ApiResponse<LogsResult>> {
    try {
      const params = new URLSearchParams();
      if (nodeId) params.set('node', nodeId);
      if (file) params.set('file', file);
      if (level && level !== 'all') params.set('level', level);
      if (query) params.set('q', query);
      if (filters.source) params.set('source', filters.source);
      if (filters.component) params.set('component', filters.component);
      if (filters.taskId) params.set('taskId', filters.taskId);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      return await apiClient.get(`api/logs${suffix}`).json<ApiResponse<LogsResult>>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  // 诊断Clash生成
  async diagnoseClash(): Promise<any> {
    try {
      return await apiClient.get('api/diagnose/mihomo').json();
    } catch (error) {
      return this.handleError(error);
    }
  }

  // 下载文件URL生成器
  getDownloadUrl(filename: string): string {
    // download=1 让服务端回 attachment；不带该参数的同一 URL 用于「打开」，走 inline。
    return `${API_BASE_URL}/${filename}?download=1`;
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
    sshPort?: number;
    sshHostKey?: string;
    sshAuthMethod: SshAuthMethod;
    sshPassword?: string;
    sshPrivateKey?: string;
    sshPrivateKeyName?: string;
    tags?: string[];
  }): Promise<ApiResponse<NodeConfig>> {
    try {
      return await apiClient.post('api/cluster/nodes', { json: data }).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async preflightNode(ssh: {
    host: string; user: string; port?: number; authMethod: SshAuthMethod;
    password?: string; privateKey?: string;
  }): Promise<ApiResponse<NodePreflightResult>> {
    try {
      return await apiClient.post('api/cluster/nodes/preflight', { json: { ssh } }).json<ApiResponse<NodePreflightResult>>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async updateNode(nodeId: string, patch: {
    name?: string; host?: string; location?: string; enabled?: boolean;
    sshUser?: string; sshPort?: number; sshAuthMethod?: SshAuthMethod;
    sshPassword?: string; sshPrivateKey?: string;
    tags?: string[];
  }): Promise<ApiResponse<NodeConfig>> {
    try {
      return await apiClient.patch('api/cluster/nodes', { json: { nodeId, ...patch } }).json<ApiResponse<NodeConfig>>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async deleteNode(nodeId: string, force = false): Promise<ApiResponse<{ nodeId: string; deleted: boolean }>> {
    try {
      return await apiClient.delete('api/cluster/nodes', { json: { nodeId, force } }).json<ApiResponse<{ nodeId: string; deleted: boolean }>>();
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

  // 获取聚合部署进度
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

  // 获取单个节点部署进度
  async getDeployProgress(nodeId: string): Promise<ApiResponse> {
    try {
      return await apiClient.get(`api/cluster/deploy/progress?node=${encodeURIComponent(nodeId)}`).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async startComponentDeployment(
    nodeId: string, component: DeployComponent, operation: DeployOperation,
    options: { preserveConfig: boolean; preserveData: boolean } = { preserveConfig: true, preserveData: true },
  ): Promise<ApiResponse<{ taskId: string }>> {
    try {
      return await apiClient.post('api/deployments', {
        headers: { 'Idempotency-Key': createIdempotencyKey() }, json: { nodeId, component, operation, options },
      }).json<ApiResponse<{ taskId: string }>>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async preflightDeployment(nodeId: string): Promise<ApiResponse<NodePreflightResult>> {
    try {
      return await apiClient.post(`api/cluster/nodes/${encodeURIComponent(nodeId)}/preflight`).json<ApiResponse<NodePreflightResult>>();
    } catch (error) { return this.handleError(error); }
  }

  async getComponentDeployments(nodeIds?: string[]): Promise<ApiResponse<{ deployments: Record<string, ComponentDeployStatus> }>> {
    try {
      const suffix = nodeIds?.length ? `?nodes=${encodeURIComponent(nodeIds.join(','))}` : '';
      return await apiClient.get(`api/deployments${suffix}`)
        .json<ApiResponse<{ deployments: Record<string, ComponentDeployStatus> }>>();
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getComponentDeployment(taskId: string): Promise<ApiResponse<ComponentDeployStatus>> {
    try { return await apiClient.get(`api/deployments/${encodeURIComponent(taskId)}`).json<ApiResponse<ComponentDeployStatus>>(); }
    catch (error) { return this.handleError(error); }
  }

  async cancelComponentDeployment(taskId: string): Promise<ApiResponse<ComponentDeployStatus>> {
    try { return await apiClient.post(`api/deployments/${encodeURIComponent(taskId)}/cancel`).json<ApiResponse<ComponentDeployStatus>>(); }
    catch (error) { return this.handleError(error); }
  }

  async retryComponentDeployment(taskId: string): Promise<ApiResponse<{ taskId: string }>> {
    try { return await apiClient.post(`api/deployments/${encodeURIComponent(taskId)}/retry`).json<ApiResponse<{ taskId: string }>>(); }
    catch (error) { return this.handleError(error); }
  }

  manualAgentConfigUrl(nodeId: string): string {
    return `/api/deployments/agent/manual-config?nodeId=${encodeURIComponent(nodeId)}`;
  }

  async getComponentStates(nodeIds?: string[]): Promise<ApiResponse<{ states: ComponentState[]; updatedAt: string }>> {
    try {
      const suffix = nodeIds?.length ? `?nodes=${encodeURIComponent(nodeIds.join(','))}` : '';
      return await apiClient.get(`api/cluster/components${suffix}`).json<ApiResponse<{ states: ComponentState[]; updatedAt: string }>>();
    } catch (error) { return this.handleError(error); }
  }

  async preflightSubscription(): Promise<ApiResponse<SubscriptionPreflight>> {
    try { return await apiClient.post('api/subscription-jobs/preflight').json<ApiResponse<SubscriptionPreflight>>(); }
    catch (error) { return this.handleError(error); }
  }

  async startSubscriptionJob(): Promise<ApiResponse<{ jobId: string }>> {
    try {
      return await apiClient.post('api/subscription-jobs', { headers: { 'Idempotency-Key': createIdempotencyKey() } }).json<ApiResponse<{ jobId: string }>>();
    } catch (error) { return this.handleError(error); }
  }

  async getSubscriptionJobs(): Promise<ApiResponse<{ jobs: SubscriptionJob[] }>> {
    try { return await apiClient.get('api/subscription-jobs').json<ApiResponse<{ jobs: SubscriptionJob[] }>>(); }
    catch (error) { return this.handleError(error); }
  }

  async retrySubscriptionJob(jobId: string): Promise<ApiResponse<{ jobId: string }>> {
    try { return await apiClient.post(`api/subscription-jobs/${encodeURIComponent(jobId)}/retry`).json<ApiResponse<{ jobId: string }>>(); }
    catch (error) { return this.handleError(error); }
  }

  async getArtifacts(): Promise<ApiResponse<{ artifacts: ArtifactState[] }>> {
    try { return await apiClient.get('api/artifacts').json<ApiResponse<{ artifacts: ArtifactState[] }>>(); }
    catch (error) { return this.handleError(error); }
  }

  async previewArtifact(name: ArtifactState['name']): Promise<ApiResponse<{ name: string; content: string; truncated: boolean }>> {
    try { return await apiClient.get(`api/artifacts/${encodeURIComponent(name)}/preview`).json<ApiResponse<{ name: string; content: string; truncated: boolean }>>(); }
    catch (error) { return this.handleError(error); }
  }

  async validateArtifacts(name?: ArtifactState['name']): Promise<ApiResponse<{ artifacts: ArtifactState[] }>> {
    try { return await apiClient.post('api/artifacts/validate', { json: name ? { name } : {} }).json<ApiResponse<{ artifacts: ArtifactState[] }>>(); }
    catch (error) { return this.handleError(error); }
  }

  async getSubscriptionPolicy(): Promise<ApiResponse<SubscriptionPolicy>> {
    try { return await apiClient.get('api/subscription-policy').json<ApiResponse<SubscriptionPolicy>>(); }
    catch (error) { return this.handleError(error); }
  }

  async updateSubscriptionPolicy(policy: SubscriptionPolicy): Promise<ApiResponse<SubscriptionPolicy>> {
    try { return await apiClient.put('api/subscription-policy', { json: policy }).json<ApiResponse<SubscriptionPolicy>>(); }
    catch (error) { return this.handleError(error); }
  }

  async getConfigSchema(): Promise<ApiResponse<{ fields: Array<{ path: string; type: string; restartRequired: boolean; minimum?: number; maximum?: number; allowed?: string[] }> }>> {
    try { return await apiClient.get('api/config/schema').json(); }
    catch (error) { return this.handleError(error); }
  }

  async getEffectiveConfig(): Promise<ApiResponse<{ config: Record<string, unknown>; path: string }>> {
    try { return await apiClient.get('api/config/effective').json(); }
    catch (error) { return this.handleError(error); }
  }

  async validateConfigSource(source: string): Promise<ApiResponse<{ valid: boolean; issues: Array<{ path: string; message: string }> }>> {
    try { return await apiClient.post('api/config/validate', { json: { source }, throwHttpErrors: false }).json(); }
    catch (error) { return this.handleError(error); }
  }

  async patchConfig(path: string, value: unknown): Promise<ApiResponse<{ path: string; value: unknown; applied: boolean; restartRequired: boolean }>> {
    try { return await apiClient.patch('api/config', { json: { path, value } }).json(); }
    catch (error) { return this.handleError(error); }
  }

  async patchConfigValues(changes: Array<{ path: string; value: unknown }>): Promise<ApiResponse<{ results: Array<{ path: string; value: unknown; applied: boolean; restartRequired: boolean }>; restartRequired: boolean; backupPath?: string }>> {
    try { return await apiClient.patch('api/config', { json: { changes } }).json(); }
    catch (error) { return this.handleError(error); }
  }

  async restoreConfig(): Promise<ApiResponse<{ restored: true; backupPath: string }>> {
    try { return await apiClient.post('api/config/restore').json(); }
    catch (error) { return this.handleError(error); }
  }

  async previewConfigImport(source: string): Promise<ApiResponse<{ validation: unknown; differences: Array<{ path: string; before: unknown; after: unknown }> }>> {
    try { return await apiClient.post('api/config/import/preview', { json: { source }, throwHttpErrors: false }).json(); }
    catch (error) { return this.handleError(error); }
  }

  async getMetrics(range: '24h' | '7d' | '30d' = '24h'): Promise<ApiResponse<{ range: string; snapshot: MetricsSnapshot; history: MetricsSnapshot[]; summary: MetricsSummary }>> {
    try { return await apiClient.get(`api/metrics?range=${range}`).json(); }
    catch (error) { return this.handleError(error); }
  }

  async getOpenApi(): Promise<any> {
    try { return await apiClient.get('api/openapi.json').json(); }
    catch (error) { return this.handleError(error); }
  }

  async testWebhook(): Promise<ApiResponse<{ id: string; event: string; ok: boolean; statusCode: number; timestamp: string }>> {
    try { return await apiClient.post('api/notifications/test').json(); }
    catch (error) { return this.handleError(error); }
  }

  async getNotificationHistory(): Promise<ApiResponse<{ records: Array<{ id: string; event: string; ok: boolean; statusCode: number; timestamp: string }> }>> {
    try { return await apiClient.get('api/notifications/history').json(); }
    catch (error) { return this.handleError(error); }
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

  async kernelAction(nodeId: string, kernelType: KernelType, action: 'start' | 'stop' | 'restart'): Promise<ApiResponse> {
    try {
      return await apiClient.post('api/cluster/kernel/action', { json: { nodeId, kernelType, action } }).json<ApiResponse>();
    } catch (error) {
      return this.handleError(error);
    }
  }
}

export const apiService = new ApiService();
