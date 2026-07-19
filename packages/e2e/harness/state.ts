import type { DashboardRequest } from '@miobridge/cli';

export interface FixtureKernelConfig {
  readonly type: 'sing-box' | 'xray' | 'v2ray';
  readonly configPath?: string;
}

export interface FixtureNode {
  id: string;
  nodeId: string;
  name: string;
  host: string;
  location: string;
  enabled: boolean;
  tags: string[];
  sshUser: string;
  sshPort: number;
  sshHostKey: string;
  ssh?: { user: string; port: number; authMethod: 'password' | 'privateKey'; hostKey: string };
  configuredKernels: FixtureKernelConfig[];
  kernels: Array<{
    type: 'sing-box' | 'xray' | 'v2ray'; detected: boolean; monitored: boolean; accessible: boolean;
    nodesCount: number; version?: string; configPaths: string[]; error?: string; binaryPath?: string;
  }>;
  online: boolean;
  latency?: number;
  nodesCount?: number;
  subscriptionExists?: boolean;
  clashExists?: boolean;
  mihomoAvailable?: boolean;
  mihomoVersion?: string;
  version?: string;
  uptime?: number;
  agent: {
    deployed: boolean; version: string; status: 'not_deployed' | 'deploying' | 'running' | 'stopped' | 'error';
    lastDeploy: string; port?: number; deploymentId?: string;
  };
  lastError?: string;
}

export interface FixtureDeploymentTask {
  taskId: string;
  idempotencyKey: string;
  nodeId: string;
  component: 'agent' | 'mihomo' | 'sing-box' | 'xray' | 'v2ray';
  operation: 'install' | 'reinstall' | 'upgrade' | 'repair' | 'uninstall';
  step: 'queued' | 'prechecking' | 'downloading' | 'verifying_package' | 'installing' | 'configuring' | 'restarting' | 'postchecking' | 'done';
  status: 'pending' | 'running' | 'success' | 'error' | 'cancelled';
  message: string;
  progress: number;
  actorRole: 'admin';
  options: { preserveConfig: boolean; preserveData: boolean };
  createdAt: string;
  startedAt: number;
  finishedAt?: number;
  beforeVersion?: string;
  afterVersion?: string;
  retryOf?: string;
  errorCode?: string;
}

export interface FixtureDeploymentEvent {
  readonly eventId: string;
  readonly taskId: string;
  readonly nodeId: string;
  readonly component: FixtureDeploymentTask['component'];
  readonly status: FixtureDeploymentTask['status'];
  readonly step: FixtureDeploymentTask['step'];
  readonly progress: number;
  readonly message: string;
  readonly timestamp: string;
}

export interface FixtureSubscriptionJob {
  id: string;
  idempotencyKey: string;
  actorRole: 'admin';
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

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface ArtifactFixture {
  readonly name: 'raw.txt' | 'subscription.txt' | 'clash.yaml';
  content: string;
  exists: boolean;
  valid: boolean;
  updatedAt: string;
  freshness: 'fresh' | 'expiring' | 'stale' | 'invalid';
  validationError?: string;
}

export interface HarnessControls {
  nodesEmpty?: boolean;
  nodePreflightFailure?: string;
  nodeUpdateFailure?: boolean;
  deploymentOutcome?: 'success' | 'error';
  deploymentHoldAt?: 'queued' | 'prechecking' | 'installing';
  agentFailure?: boolean;
  kernelFailure?: boolean;
  monitoringFailure?: boolean;
  subscriptionReady?: boolean;
  subscriptionJobStatus?: FixtureSubscriptionJob['status'];
  subscriptionFailure?: boolean;
  subscriptionPreflightFailure?: boolean;
  subscriptionStartFailure?: boolean;
  subscriptionRetryFailure?: boolean;
  artifactsMissing?: boolean;
  artifactInvalid?: ArtifactFixture['name'];
  artifactStale?: ArtifactFixture['name'];
  conversionFailure?: boolean;
  policyInvalid?: boolean;
  logFailure?: boolean;
  configValidationFailure?: boolean;
  configSaveFailure?: boolean;
  configRestoreFailure?: boolean;
  webhookStatus?: number;
  openApiFailure?: boolean;
  [key: string]: unknown;
}

export interface HarnessState {
  origin: string;
  nodes: FixtureNode[];
  tasks: Map<string, FixtureDeploymentTask>;
  events: Map<string, FixtureDeploymentEvent[]>;
  subscriptionJobs: Map<string, FixtureSubscriptionJob>;
  subscriptionEvents: Map<string, Array<Record<string, unknown>>>;
  requests: RecordedRequest[];
  downloadedManualConfigs: number;
  idempotency: Map<string, string>;
  subscriptionIdempotency: Map<string, string>;
  controls: HarnessControls;
  artifacts: ArtifactFixture[];
  policy: Record<string, unknown>;
  config: Record<string, unknown>;
  lastGoodConfig: Record<string, unknown>;
  webhooks: Array<Record<string, unknown>>;
  notificationHistory: Array<Record<string, unknown>>;
  kv: Map<string, string>;
  timers: Set<ReturnType<typeof setTimeout>>;
  sequence: number;
}

const now = () => new Date().toISOString();

function baselineNodes(): FixtureNode[] {
  return [
    {
      id: 'node-ready', nodeId: 'node-ready', name: '上海边缘节点', host: 'ready-node.e2e.invalid',
      location: 'CN-SHA', enabled: true, tags: ['edge', 'ready'], sshUser: 'root', sshPort: 22,
      sshHostKey: 'SHA256:e2e-ready-host-key', ssh: { user: 'root', port: 22, authMethod: 'password', hostKey: 'SHA256:e2e-ready-host-key' },
      configuredKernels: [{ type: 'sing-box', configPath: '/opt/e2e/sing-box.json' }],
      kernels: [
        { type: 'sing-box', detected: true, monitored: true, accessible: true, nodesCount: 3, version: '1.12.0-e2e', configPaths: ['/opt/e2e/sing-box.json'], binaryPath: '/opt/e2e/bin/sing-box' },
        { type: 'xray', detected: true, monitored: false, accessible: false, nodesCount: 0, version: '25.1-e2e', configPaths: ['/etc/xray/config.json'], binaryPath: '/opt/e2e/bin/xray' },
        { type: 'v2ray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
      ],
      online: true, latency: 12, nodesCount: 3, subscriptionExists: true, clashExists: true,
      mihomoAvailable: true, mihomoVersion: 'v1.19.0-e2e', version: '1.0.0-e2e', uptime: 7200,
      agent: { deployed: true, version: '1.0.0-e2e', status: 'running', lastDeploy: now(), port: 3001 },
      lastError: 'fixture recent error',
    },
    {
      id: 'node-empty', nodeId: 'node-empty', name: '待部署节点', host: 'empty-node.e2e.invalid',
      location: 'E2E-LAB', enabled: true, tags: ['empty'], sshUser: 'root', sshPort: 22,
      sshHostKey: 'SHA256:e2e-empty-host-key', ssh: { user: 'root', port: 22, authMethod: 'password', hostKey: 'SHA256:e2e-empty-host-key' },
      configuredKernels: [], kernels: [
        { type: 'sing-box', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
        { type: 'xray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
        { type: 'v2ray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
      ],
      online: false, mihomoAvailable: false,
      agent: { deployed: false, version: '', status: 'not_deployed', lastDeploy: '' },
    },
  ];
}

function baselineArtifacts(): ArtifactFixture[] {
  const updatedAt = now();
  return [
    { name: 'raw.txt', content: 'vless://e2e@example.invalid:443#fixture\n', exists: true, valid: true, updatedAt, freshness: 'fresh' },
    { name: 'subscription.txt', content: 'dmxlc3M6Ly9lMmVAZXhhbXBsZS5pbnZhbGlkOjQ0Mw==\n', exists: true, valid: true, updatedAt, freshness: 'fresh' },
    { name: 'clash.yaml', content: 'proxies:\n  - name: e2e\n    type: vless\n    server: example.invalid\n    port: 443\n', exists: true, valid: true, updatedAt, freshness: 'fresh' },
  ];
}

function baselineConfig(origin: string): Record<string, unknown> {
  return {
    app: { port: 3000, log_level: 'info' },
    network: { request_timeout: 30000 },
    subscription: { enabled: false, retry_delays_minutes: [1, 5, 15] },
    protocols: { sing_box_configs: ['/etc/sing-box/config.json'] },
    notifications: { webhook: { enabled: true, url: `${origin}/__e2e__/webhook`, token: 'e2e-password' } },
  };
}

export function createHarnessState(origin: string): HarnessState {
  const config = baselineConfig(origin);
  const state: HarnessState = {
    origin, nodes: baselineNodes(), tasks: new Map(), events: new Map(), subscriptionJobs: new Map(),
    subscriptionEvents: new Map(), requests: [], downloadedManualConfigs: 0,
    idempotency: new Map(), subscriptionIdempotency: new Map(), controls: {}, artifacts: baselineArtifacts(),
    policy: { enabled: false, cron: '0 */6 * * *', freshnessHours: 24, nodeDropPercent: 30, retryDelaysMinutes: [1, 5, 15], backupRetention: 30 },
    config, lastGoodConfig: structuredClone(config), webhooks: [], notificationHistory: [], kv: new Map(), timers: new Set(), sequence: 0,
  };
  seedSubscriptionJob(state, 'succeeded');
  return state;
}

export function resetHarnessState(state: HarnessState, origin: string, scenario = 'baseline'): void {
  for (const timer of state.timers) clearTimeout(timer);
  const fresh = createHarnessState(origin);
  if (scenario === 'empty') {
    fresh.nodes = [];
    fresh.subscriptionJobs.clear();
    fresh.subscriptionEvents.clear();
    fresh.artifacts = fresh.artifacts.map(artifact => ({ ...artifact, exists: false, valid: false, content: '', freshness: 'invalid' }));
  }
  Object.assign(state, fresh);
}

export function controlHarnessState(state: HarnessState, flags: Readonly<Record<string, unknown>>): void {
  Object.assign(state.controls, flags);
  if (flags.nodesEmpty === true) state.nodes = [];
  else if (flags.nodesEmpty === false) state.nodes = baselineNodes();
  if (typeof flags.subscriptionJobStatus === 'string') seedSubscriptionJob(state, flags.subscriptionJobStatus as FixtureSubscriptionJob['status']);
  if (flags.artifactsMissing === true) {
    state.artifacts = state.artifacts.map(artifact => ({ ...artifact, exists: false, valid: false, content: '', freshness: 'invalid' }));
  } else if (flags.artifactsMissing === false) {
    state.artifacts = baselineArtifacts();
  }
  if (typeof flags.artifactInvalid === 'string') {
    state.artifacts = state.artifacts.map(artifact => artifact.name === flags.artifactInvalid
      ? { ...artifact, exists: true, valid: false, freshness: 'invalid', validationError: 'fixture artifact validation failure' }
      : artifact);
  }
  if (typeof flags.artifactStale === 'string') {
    state.artifacts = state.artifacts.map(artifact => artifact.name === flags.artifactStale
      ? { ...artifact, exists: true, valid: true, freshness: 'stale', updatedAt: '2026-01-01T00:00:00.000Z' }
      : artifact);
  }
}

export function seedSubscriptionJob(state: HarnessState, status: FixtureSubscriptionJob['status']): FixtureSubscriptionJob {
  state.subscriptionJobs.clear();
  state.subscriptionEvents.clear();
  const id = `subscription-${++state.sequence}`;
  const terminal = ['succeeded', 'partial', 'failed'].includes(status);
  const job: FixtureSubscriptionJob = {
    id, idempotencyKey: `fixture-${id}`, actorRole: 'admin', status,
    step: terminal ? 'done' : status === 'running' ? 'convert' : 'collect',
    progress: terminal ? 100 : status === 'running' ? 68 : 0,
    message: status === 'succeeded' ? '订阅生成完成' : status === 'partial' ? '部分来源失败' : status === 'failed' ? '订阅生成失败' : status === 'running' ? '正在转换' : '已进入队列',
    sourcesTotal: 3, sourcesSucceeded: status === 'failed' ? 0 : status === 'partial' ? 2 : 3,
    nodesGenerated: status === 'failed' ? 0 : 4,
    warnings: status === 'partial' ? ['一个远端来源不可用'] : [], errors: status === 'failed' ? ['FIXTURE_FAILURE'] : [],
    createdAt: now(), ...(status === 'queued' ? {} : { startedAt: now() }),
    ...(terminal ? { finishedAt: now() } : {}),
    ...(status === 'succeeded' || status === 'partial' ? { backupId: `backup-${id}` } : {}),
  };
  state.subscriptionJobs.set(id, job);
  const runningSteps: Array<Pick<FixtureSubscriptionJob, 'step' | 'progress' | 'message'>> = [
    { step: 'collect', progress: 10, message: '采集本机与远端来源' },
    { step: 'parse', progress: 25, message: '解析代理来源' },
    { step: 'deduplicate', progress: 40, message: '去重并整理代理节点' },
    { step: 'encode', progress: 55, message: '编码订阅内容' },
    { step: 'convert', progress: 68, message: '生成 Clash 衍生产物' },
    { step: 'validate', progress: 82, message: '验证每个订阅产物' },
    { step: 'publish', progress: 92, message: '发布正式产物' },
    { step: 'backup', progress: 97, message: '保存订阅备份并清理保留范围' },
  ];
  const visibleSteps = status === 'queued'
    ? []
    : status === 'running'
      ? runningSteps.slice(0, 5)
      : runningSteps;
  const eventInputs = [
    { status: 'queued' as const, step: 'collect' as const, progress: 0, message: '订阅生成任务已进入队列' },
    ...visibleSteps.map(step => ({ ...step, status: 'running' as const })),
    ...(['succeeded', 'partial', 'failed'].includes(status)
      ? [{ status, step: 'done' as const, progress: 100, message: job.message }]
      : []),
  ];
  state.subscriptionEvents.set(id, eventInputs.map((event, index) => ({
    eventId: String(index + 1).padStart(8, '0'), jobId: id, ...event, timestamp: now(),
  })));
  return job;
}

export function recordHarnessRequest(state: HarnessState, request: DashboardRequest): void {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query)) {
    if (Array.isArray(value)) value.forEach(item => search.append(key, item));
    else if (typeof value === 'string') search.set(key, value);
  }
  const headers = Object.fromEntries(Object.entries(request.headers).flatMap(([key, value]) => {
    if (typeof value === 'string') return [[key.toLowerCase(), value]];
    if (Array.isArray(value)) return [[key.toLowerCase(), value.join(', ')]];
    return [];
  }));
  state.requests.push({
    method: request.method,
    path: `${request.path}${search.size ? `?${search}` : ''}`,
    query: structuredClone(request.query),
    headers,
    body: structuredClone(request.body),
  });
}

export function harnessSnapshot(state: HarnessState): Record<string, unknown> {
  return structuredClone({
    requests: state.requests,
    nodes: state.nodes,
    deploymentTasks: [...state.tasks.values()],
    subscriptionJobs: [...state.subscriptionJobs.values()],
    downloadedManualConfigs: state.downloadedManualConfigs,
    config: state.config,
    policy: state.policy,
    artifacts: state.artifacts.map(artifact => ({ ...artifact, size: Buffer.byteLength(artifact.content) })),
    webhooks: state.webhooks,
    webhookStatus: state.controls.webhookStatus ?? 204,
  });
}
