/**
 * Dashboard HTTP API client — typed, no server imports.
 *
 * Every SPA data load goes through these functions; no `getServerSideProps`,
 * no direct core/frontend-server imports, no Node builtins.
 */

const API_BASE = '';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp?: string;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  const json: ApiResponse<T> = await res.json();
  if (!json.success && json.error) throw new Error(json.error);
  return json.data as T;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  const json: ApiResponse<T> = await res.json();
  if (!json.success && json.error) throw new Error(json.error);
  return json.data as T;
}

async function apiGetRaw(path: string): Promise<string> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── Types ───────────────────────────────────────────────────────────

export interface ClusterStatus {
  nodes: NodeStatus[];
  summary?: { total: number; online: number; error: number };
}

export interface NodeStatus {
  id: string;
  name: string;
  host: string;
  port: number;
  enabled: boolean;
  location?: string;
  status: 'online' | 'offline' | 'error' | 'unknown';
  kernels: KernelStatus[];
  agent?: { deployed: boolean; version?: string; status: string; lastDeploy?: string; port?: number };
}

export interface KernelStatus {
  type: 'sing-box' | 'xray' | 'v2ray';
  installed: boolean;
  version?: string;
  running: boolean;
  configPath?: string;
}

export interface DeployStatus {
  nodeId: string;
  deploymentId: string;
  step: string;
  status: 'running' | 'success' | 'error';
  message: string;
  progress: number;
  startedAt: number;
}

export interface ApiStatus {
  subscription: { updatedAt?: string; proxyCount: number };
  local: { running: boolean };
  version: string;
}

export interface UpdateResult {
  updatedAt: string;
  proxyCount: number;
  message?: string;
}

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  memory: NodeJS.MemoryUsage;
  version: string;
}

export interface ConfigData {
  configs: string[];
  count: number;
}

export interface LogsResult {
  lines: string[];
  nodeId?: string;
}

export interface YamlConfig {
  app?: Record<string, unknown>;
  network?: Record<string, unknown>;
  external?: Record<string, unknown>;
  protocols?: Record<string, unknown>;
  cors?: Record<string, unknown>;
}

// ── API functions ───────────────────────────────────────────────────

export const dashboardApi = {
  // Core
  getStatus: () => apiGet<ApiStatus>('/api/status'),
  updateSubscription: () => apiGet<UpdateResult>('/api/update'),
  getHealth: () => apiGet<HealthStatus>('/health'),

  // Artifacts
  getFile: (name: string) => apiGetRaw(`/api/file/${name}`),
  getSubscription: () => apiGetRaw('/subscription.txt'),
  getClash: () => apiGetRaw('/clash.yaml'),
  getRaw: () => apiGetRaw('/raw.txt'),

  // Cluster
  getClusterStatus: () => apiGet<ClusterStatus>('/api/cluster/status'),
  getClusterHealth: (nodeId?: string) =>
    apiGet<unknown>(`/api/cluster/health${nodeId ? `?node=${nodeId}` : ''}`),
  triggerClusterUpdate: (nodeId?: string) =>
    apiGet<unknown>(`/api/cluster/update${nodeId ? `?node=${nodeId}` : ''}`),

  // Nodes
  addNode: (body: unknown) => apiPost<unknown>('/api/cluster/nodes', body),

  // Agent
  restartAgent: (nodeId: string) => apiPost(`/api/cluster/agent/restart`, { nodeId }),
  startAgent: (nodeId: string) => apiPost(`/api/cluster/agent/start`, { nodeId }),
  stopAgent: (nodeId: string) => apiPost(`/api/cluster/agent/stop`, { nodeId }),
  uninstallAgent: (nodeId: string) => apiPost(`/api/cluster/agent/uninstall`, { nodeId }),
  updateAgent: (nodeId: string) => apiPost(`/api/cluster/agent/update`, { nodeId }),

  // Deploy
  deployToNode: (nodeId: string, kernels?: unknown) =>
    apiPost<unknown>('/api/cluster/deploy', { nodeId, kernels }),
  getDeployProgress: (nodeId: string) =>
    apiGet<unknown>(`/api/cluster/deploy/progress?node=${nodeId}`),
  getAllDeployStatuses: (nodeIds?: string[]) =>
    apiGet<unknown>(`/api/cluster/deploy/status${nodeIds ? `?nodes=${nodeIds.join(',')}` : ''}`),

  // Kernel
  detectKernels: (body: unknown) => apiPost<unknown>('/api/cluster/kernel/detect', body),
  installKernel: (kernelType: string) => apiPost<unknown>('/api/cluster/kernel/install', { kernelType }),
  uninstallKernel: (nodeId: string, kernelType: string) =>
    apiPost<unknown>('/api/cluster/kernel/uninstall', { nodeId, kernelType }),

  // Config
  getConfigs: () => apiGet<ConfigData>('/api/configs'),
  updateConfigs: (configs: string[]) => apiPost<ConfigData>('/api/configs', { configs }),

  // Logs
  getRemoteLogs: (nodeId: string, filters?: { file?: string; level?: string; q?: string }) => {
    const params = new URLSearchParams({ node: nodeId });
    if (filters?.file) params.set('file', filters.file);
    if (filters?.level) params.set('level', filters.level);
    if (filters?.q) params.set('q', filters.q);
    return apiGet<LogsResult>(`/api/logs?${params}`);
  },

  // YAML
  getYamlConfig: () => apiGet<YamlConfig>('/api/yaml/config'),
  getFrontendConfig: () => apiGet<YamlConfig>('/api/yaml/frontend'),
  generateConfig: (templatePath: string, outputPath?: string) =>
    apiPost<unknown>('/api/yaml/generate', { templatePath, outputPath }),
  validateConfig: () => apiGet<unknown>('/api/yaml/validate'),

  // Convert
  convertContent: (content: string) => apiPost<unknown>('/api/convert', { content }),
  diagnoseMihomo: () => apiGet<unknown>('/api/diagnose/mihomo'),
  testProtocols: () => apiGet<unknown>('/api/test/protocols'),

  // SSE
  clusterEventsUrl: () => `${API_BASE}/api/cluster/events`,
};
