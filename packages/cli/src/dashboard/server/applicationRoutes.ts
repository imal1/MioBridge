import { KERNEL_TYPES, type NodeKernelConfig } from '@miobridge/core';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { DashboardServerDependencies, OperationsResult } from './composition.js';
import type { DashboardRequest, DashboardResponse, DashboardRouteRegistrar } from './http.js';

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { code: string; message: string; retryable: boolean; field?: string; taskId?: string };
  readonly timestamp: string;
  readonly requestId: string;
  readonly role: 'admin';
}

export function registerApplicationRoutes(registrar: DashboardRouteRegistrar, deps: DashboardServerDependencies): void {
  route(registrar, 'POST', '/api/deployments/preflight', async (req, res) => {
    await sendResult(req, res, await deps.operations.preflightNode(req.body));
  });

  route(registrar, 'POST', '/api/deployments', async (req, res) => {
    const body = object(req.body);
    const nodeId = string(body.nodeId, 'nodeId');
    const component = string(body.component, 'component');
    const operation = string(body.operation, 'operation');
    const options = body.options && typeof body.options === 'object' && !Array.isArray(body.options)
      ? body.options as { preserveConfig?: boolean; preserveData?: boolean }
      : undefined;
    const idempotencyKey = header(req, 'idempotency-key');
    const result = await deps.operations.startComponentDeployment(nodeId, component, operation, {
      ...(idempotencyKey ? { idempotencyKey } : {}), ...(options ? { options } : {}),
    });
    await sendResult(req, res, result, 202);
  });

  route(registrar, 'GET', '/api/deployments', async (req, res) => {
    const nodes = queryList(req, 'nodes');
    await sendResult(req, res, await deps.operations.getComponentDeployments(nodes.length ? nodes : undefined));
  });

  route(registrar, 'GET', '/api/deployments/agent/manual-config', async (req, res) => {
    const nodeId = queryString(req, 'nodeId');
    if (!nodeId) throw fieldError('nodeId', '缺少 nodeId');
    const result = await deps.operations.getManualAgentConfig(nodeId);
    if (!result.success) return sendResult(req, res, result);
    const data = result.data as { content: string };
    res.header('Content-Type', 'application/yaml; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename="miobridge-agent-${safeFilename(nodeId)}.yaml"`);
    res.text(data.content);
  });

  route(registrar, 'GET', '/api/deployments/:id', async (req, res) => {
    const result = await deps.operations.getComponentDeployment(req.params.id!);
    if (result.success && result.data === null) return sendError(req, res, 'TASK_NOT_FOUND', '部署任务不存在', false, 404);
    await sendResult(req, res, result);
  });

  route(registrar, 'POST', '/api/deployments/:id/cancel', async (req, res) => {
    await sendResult(req, res, await deps.operations.cancelComponentDeployment(req.params.id!));
  });

  route(registrar, 'POST', '/api/deployments/:id/retry', async (req, res) => {
    await sendResult(req, res, await deps.operations.retryComponentDeployment(req.params.id!), 202);
  });

  route(registrar, 'GET', '/api/deployments/:id/logs', async (req, res) => {
    const result = await deps.operations.getDeploymentLog(req.params.id!);
    if (!result.success) return sendResult(req, res, result);
    res.header('Content-Type', 'text/plain; charset=utf-8');
    res.text((result.data as { content: string }).content);
  });

  route(registrar, 'GET', '/api/deployments/:id/events', async (req, res) => {
    if (!header(req, 'accept')?.includes('text/event-stream')) {
      return sendResult(req, res, await deps.operations.getDeploymentEvents(req.params.id!, queryString(req, 'after')));
    }
    await streamDeploymentEvents(req, res, deps);
  });

  route(registrar, 'GET', '/api/cluster/components', async (req, res) => {
    const nodes = queryList(req, 'nodes');
    await sendResult(req, res, await deps.operations.getComponentStates(nodes.length ? nodes : undefined));
  });

  route(registrar, 'POST', '/api/cluster/components/detect', async (req, res) => {
    const body = object(req.body);
    const nodeId = string(body.nodeId, 'nodeId');
    await deps.operations.detectKernels({ nodeId });
    await sendResult(req, res, await deps.operations.getComponentStates([nodeId]));
  });

  route(registrar, 'POST', '/api/cluster/components/:component/:action', async (req, res) => {
    const body = object(req.body);
    const nodeId = string(body.nodeId, 'nodeId');
    const component = req.params.component!;
    const action = req.params.action!;
    if (!['start', 'stop', 'restart'].includes(action)) throw new Error(`不支持的维护操作: ${action}`);
    const result = component === 'agent'
      ? action === 'start' ? await deps.operations.startAgent(nodeId)
        : action === 'stop' ? await deps.operations.stopAgent(nodeId)
          : await deps.operations.restartAgent(nodeId)
      : component === 'mihomo'
        ? { success: false, error: 'mihomo 为 CLI 模式，运行维护不适用', statusCode: 409, timestamp: new Date().toISOString() }
        : await deps.operations.kernelAction(nodeId, component, action);
    await sendResult(req, res, result);
  });

  route(registrar, 'PUT', '/api/cluster/components/:component/monitoring', async (req, res) => {
    const body = object(req.body);
    const nodeId = string(body.nodeId, 'nodeId');
    const component = req.params.component!;
    if (!KERNEL_TYPES.includes(component as typeof KERNEL_TYPES[number])) throw new Error('只有协议核心可以配置 Agent 监控');
    const cluster = await deps.operations.getClusterStatus();
    const nodes = ((cluster.data as { nodes?: Array<{ nodeId: string; configuredKernels: NodeKernelConfig[] }> })?.nodes ?? []);
    const node = nodes.find(item => item.nodeId === nodeId);
    if (!node) throw new Error(`节点 ${nodeId} 不存在`);
    const enabled = body.enabled !== false;
    const configPath = typeof body.configPath === 'string' ? body.configPath : undefined;
    const kernels = node.configuredKernels.filter(item => item.type !== component);
    if (enabled) kernels.push({ type: component as NodeKernelConfig['type'], ...(configPath ? { configPath } : {}) });
    await sendResult(req, res, await deps.operations.updateNodeKernels(nodeId, kernels));
  });

  route(registrar, 'PATCH', '/api/cluster/nodes/:id', async (req, res) => {
    await sendResult(req, res, await deps.operations.updateNode(req.params.id!, req.body));
  });
  route(registrar, 'DELETE', '/api/cluster/nodes/:id', async (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
    await sendResult(req, res, await deps.operations.deleteNode(req.params.id!, body.force === true));
  });
  route(registrar, 'POST', '/api/cluster/nodes/:id/preflight', async (req, res) => {
    await sendResult(req, res, await deps.operations.preflightNode({ nodeId: req.params.id }));
  });

  route(registrar, 'POST', '/api/subscription-jobs/preflight', async (req, res) => {
    await sendResult(req, res, await deps.subscription.preflight());
  });
  route(registrar, 'POST', '/api/subscription-jobs', async (req, res) => {
    await sendResult(req, res, await deps.subscription.start(header(req, 'idempotency-key')), 202);
  });
  route(registrar, 'GET', '/api/subscription-jobs', async (req, res) => {
    await sendResult(req, res, await deps.subscription.list());
  });
  route(registrar, 'GET', '/api/subscription-jobs/:id', async (req, res) => {
    const result = await deps.subscription.get(req.params.id!);
    if (result.success && result.data === null) return sendError(req, res, 'JOB_NOT_FOUND', '订阅任务不存在', false, 404);
    await sendResult(req, res, result);
  });
  route(registrar, 'POST', '/api/subscription-jobs/:id/retry', async (req, res) => {
    await sendResult(req, res, await deps.subscription.retry(req.params.id!), 202);
  });
  route(registrar, 'GET', '/api/subscription-jobs/:id/events', async (req, res) => {
    if (!header(req, 'accept')?.includes('text/event-stream')) {
      return sendResult(req, res, await deps.subscription.events(req.params.id!, queryString(req, 'after')));
    }
    await streamSubscriptionEvents(req, res, deps);
  });

  route(registrar, 'GET', '/api/artifacts', async (req, res) => {
    await sendResult(req, res, await deps.subscription.artifacts());
  });
  route(registrar, 'GET', '/api/artifacts/:name/preview', async (req, res) => {
    await sendResult(req, res, await deps.subscription.previewArtifact(req.params.name!));
  });
  route(registrar, 'POST', '/api/artifacts/validate', async (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
    await sendResult(req, res, await deps.subscription.validateArtifacts(typeof body.name === 'string' ? body.name : undefined));
  });
  route(registrar, 'GET', '/api/subscription-policy', async (req, res) => {
    await sendResult(req, res, await deps.subscription.policy());
  });
  route(registrar, 'PUT', '/api/subscription-policy', async (req, res) => {
    await sendResult(req, res, await deps.subscription.updatePolicy(req.body));
  });

  route(registrar, 'GET', '/api/config/schema', async (req, res) => {
    res.json(envelope(req, { fields: deps.core.config.getSchema() }));
  });
  route(registrar, 'GET', '/api/config/effective', async (req, res) => {
    res.json(envelope(req, { config: deps.core.getEffectiveConfig(), path: deps.core.getConfigPath() }));
  });
  route(registrar, 'POST', '/api/config/validate', async (req, res) => {
    const body = req.body;
    const source = typeof body === 'string'
      ? body
      : body && typeof body === 'object' && !Array.isArray(body) && typeof (body as Record<string, unknown>).source === 'string'
        ? (body as Record<string, string>).source
        : stringifyYaml(body ?? {});
    const validation = deps.core.validateConfig(source);
    res.status(validation.valid ? 200 : 422).json(envelope(req, validation));
  });
  route(registrar, 'PATCH', '/api/config', async (req, res) => {
    const body = object(req.body);
    const applied = Array.isArray(body.changes)
      ? await deps.core.setConfigValues(body.changes.map((change, index) => {
        const item = object(change);
        return { path: string(item.path, `changes.${index}.path`), value: item.value };
      }))
      : await deps.core.setConfigValue(string(body.path, 'path'), body.value);
    res.json(envelope(req, applied));
  });
  route(registrar, 'POST', '/api/config/restore', async (req, res) => {
    res.json(envelope(req, await deps.core.restoreLastGoodConfig()));
  });
  route(registrar, 'GET', '/api/config/export', async (_req, res) => {
    res.header('Content-Type', 'application/yaml; charset=utf-8');
    res.header('Content-Disposition', 'attachment; filename="miobridge-config.yaml"');
    res.text(stringifyYaml(redactConfig(deps.core.getEffectiveConfig())));
  });
  route(registrar, 'POST', '/api/config/import/preview', async (req, res) => {
    const body = object(req.body);
    const source = string(body.source, 'source');
    const incoming = parseYaml(source) as unknown;
    const validation = deps.core.validateConfig(source);
    const differences = diffValues(deps.core.getEffectiveConfig(), incoming);
    res.status(validation.valid ? 200 : 422).json(envelope(req, { validation, differences }));
  });

  route(registrar, 'GET', '/api/metrics', async (req, res) => {
    const snapshot = await deps.core.getMetricsSnapshot();
    await deps.core.state.set(`metrics/${Date.now()}.json`, JSON.stringify(snapshot));
    const range = queryString(req, 'range') ?? '24h';
    const duration = range === '30d' ? 30 * 86400000 : range === '7d' ? 7 * 86400000 : 86400000;
    const cutoff = Date.now() - duration;
    const keys = await deps.core.state.listKeys('metrics/');
    const history: unknown[] = [];
    for (const key of keys) {
      const timestamp = Number(key.match(/metrics\/(\d+)\.json$/)?.[1]);
      if (!Number.isFinite(timestamp) || timestamp < cutoff) continue;
      const raw = await deps.core.state.get(key);
      if (raw) try { history.push(JSON.parse(raw)); } catch { /* Ignore malformed samples. */ }
    }
    const summary = await metricSummary(deps, cutoff, [...history, snapshot]);
    res.json(envelope(req, { range, snapshot, history, summary }));
  });

  route(registrar, 'GET', '/api/diagnostics', async (req, res) => {
    const [status, preflight, artifacts, components] = await Promise.all([
      deps.core.getStatus(), deps.subscription.preflight(), deps.subscription.artifacts(), deps.operations.getComponentStates(),
    ]);
    res.json(envelope(req, {
      generatedAt: new Date().toISOString(),
      config: deps.core.validateConfig(), status,
      subscription: preflight.success ? preflight.data : { error: preflight.error },
      artifacts: artifacts.success ? artifacts.data : { error: artifacts.error },
      components: components.success ? components.data : { error: components.error },
    }));
  });

  route(registrar, 'POST', '/api/notifications/test', async (req, res) => {
    const webhook = deps.core.getEffectiveConfig().notifications?.webhook;
    if (!webhook?.enabled || !webhook.url) throw new Error('Webhook 尚未启用或未配置 URL');
    const startedAt = new Date().toISOString();
    const response = await fetch(webhook.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'test', status: 'ok', timestamp: startedAt }),
    });
    const record = { id: `${Date.now()}`, event: 'test', ok: response.ok, statusCode: response.status, timestamp: startedAt };
    await deps.core.state.set(`notifications/${record.id}.json`, JSON.stringify(record));
    res.status(response.ok ? 200 : 502).json(envelope(req, record));
  });
  route(registrar, 'GET', '/api/notifications/history', async (req, res) => {
    const keys = (await deps.core.state.listKeys('notifications/')).sort().reverse().slice(0, 100);
    const records: unknown[] = [];
    for (const key of keys) {
      const raw = await deps.core.state.get(key);
      if (raw) try { records.push(JSON.parse(raw)); } catch { /* Ignore malformed records. */ }
    }
    res.json(envelope(req, { records }));
  });

  route(registrar, 'GET', '/api/openapi.json', async (req, res) => {
    res.json(openApiDocument(req));
  });
}

async function streamDeploymentEvents(req: DashboardRequest, res: DashboardResponse, deps: DashboardServerDependencies): Promise<void> {
  res.header('Content-Type', 'text/event-stream; charset=utf-8');
  res.header('Cache-Control', 'no-cache, no-transform');
  res.header('Connection', 'keep-alive');
  let lastEventId = header(req, 'last-event-id') ?? '';
  let closed = false;
  const removeClose = req.onClose(() => { closed = true; });
  try {
    while (!closed) {
      const result = await deps.operations.getDeploymentEvents(req.params.id!, lastEventId || undefined);
      if (!result.success) {
        res.write(`event: error\ndata: ${JSON.stringify(envelope(req, undefined, apiError('TASK_EVENTS_FAILED', result.error ?? '读取事件失败', true)))}\n\n`);
        break;
      }
      const events = (result.data as { events: Array<{ eventId: string; status: string }> }).events;
      for (const event of events) {
        lastEventId = event.eventId;
        res.write(`id: ${event.eventId}\nevent: progress\ndata: ${JSON.stringify(event)}\n\n`);
      }
      const task = await deps.operations.getComponentDeployment(req.params.id!);
      const status = (task.data as { status?: string } | null)?.status;
      if (['success', 'error', 'cancelled'].includes(status ?? '') && events.length === 0) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } finally {
    removeClose();
    res.end();
  }
}

async function streamSubscriptionEvents(req: DashboardRequest, res: DashboardResponse, deps: DashboardServerDependencies): Promise<void> {
  res.header('Content-Type', 'text/event-stream; charset=utf-8');
  res.header('Cache-Control', 'no-cache, no-transform');
  res.header('Connection', 'keep-alive');
  let lastEventId = header(req, 'last-event-id') ?? '';
  let closed = false;
  const removeClose = req.onClose(() => { closed = true; });
  try {
    while (!closed) {
      const result = await deps.subscription.events(req.params.id!, lastEventId || undefined);
      if (!result.success) break;
      const events = (result.data as { events: Array<{ eventId: string }> }).events;
      for (const event of events) {
        lastEventId = event.eventId;
        res.write(`id: ${event.eventId}\nevent: progress\ndata: ${JSON.stringify(event)}\n\n`);
      }
      const job = await deps.subscription.get(req.params.id!);
      const status = (job.data as { status?: string } | null)?.status;
      if (['succeeded', 'partial', 'failed'].includes(status ?? '') && events.length === 0) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } finally { removeClose(); res.end(); }
}

function route(
  registrar: DashboardRouteRegistrar,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  handler: (req: DashboardRequest, res: DashboardResponse) => Promise<void>,
): void {
  registrar.register({ method, path, handler: async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      const field = error instanceof RequestFieldError ? error.field : undefined;
      sendError(req, res, field ? 'INVALID_FIELD' : 'REQUEST_FAILED', error instanceof Error ? error.message : String(error), false, 400, field);
    }
  } });
}

async function sendResult(req: DashboardRequest, res: DashboardResponse, result: OperationsResult, successStatus = 200): Promise<void> {
  if (result.success) {
    res.status(successStatus).json(envelope(req, result.data));
    return;
  }
  sendError(req, res, 'OPERATION_FAILED', result.error ?? '操作失败', false, result.statusCode ?? 500);
}

function sendError(req: DashboardRequest, res: DashboardResponse, code: string, message: string, retryable: boolean, status: number, field?: string): void {
  res.status(status).json(envelope(req, undefined, apiError(code, message, retryable, field)));
}

function envelope<T>(req: DashboardRequest, data?: T, error?: ApiEnvelope<T>['error']): ApiEnvelope<T> {
  return { success: !error, ...(data !== undefined ? { data } : {}), ...(error ? { error } : {}), timestamp: new Date().toISOString(), requestId: req.requestId, role: 'admin' };
}

function apiError(code: string, message: string, retryable: boolean, field?: string): NonNullable<ApiEnvelope<unknown>['error']> {
  return { code, message, retryable, ...(field ? { field } : {}) };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求内容无效');
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw fieldError(field, `缺少字段: ${field}`);
  return value.trim();
}

function header(req: DashboardRequest, name: string): string | undefined {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : value?.[0];
}

function queryString(req: DashboardRequest, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === 'string' ? value : value?.[0];
}

function queryList(req: DashboardRequest, name: string): string[] {
  const value = queryString(req, name);
  return value?.split(',').map(item => item.trim()).filter(Boolean) ?? [];
}

function safeFilename(value: string): string { return value.replace(/[^A-Za-z0-9._-]/g, '_'); }

function diffValues(current: unknown, incoming: unknown, path = ''): Array<{ path: string; before: unknown; after: unknown }> {
  if (Object.is(current, incoming)) return [];
  if (current && incoming && typeof current === 'object' && typeof incoming === 'object' && !Array.isArray(current) && !Array.isArray(incoming)) {
    const left = current as Record<string, unknown>;
    const right = incoming as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => diffValues(left[key], right[key], path ? `${path}.${key}` : key));
  }
  return [{ path: path || '$', before: current, after: incoming }];
}

function redactConfig(value: unknown, key = ''): unknown {
  if (/secret|password|token|private[_-]?key|credential/i.test(key)) return value ? '<redacted>' : value;
  if (Array.isArray(value)) return value.map(item => redactConfig(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, redactConfig(child, childKey)]));
  }
  return value;
}

async function metricSummary(deps: DashboardServerDependencies, cutoff: number, samples: unknown[]): Promise<Record<string, unknown>> {
  const deployments = await readStateObjects(deps, 'deployment-tasks/');
  const deploymentWindow = deployments.filter(item => stateTimestamp(item) >= cutoff);
  const completedDeployments = deploymentWindow.filter(item => ['success', 'error'].includes(String(item.status)));
  const successfulDeployments = completedDeployments.filter(item => item.status === 'success').length;
  const deploymentDurations = completedDeployments.flatMap(item => {
    const start = typeof item.startedAt === 'number' ? item.startedAt : Date.parse(String(item.createdAt ?? ''));
    const end = typeof item.finishedAt === 'number' ? item.finishedAt : Number.NaN;
    return Number.isFinite(start) && Number.isFinite(end) ? [end - start] : [];
  });
  const stepDurations = new Map<string, number[]>();
  for (const task of completedDeployments) {
    const taskId = typeof task.taskId === 'string' ? task.taskId : undefined;
    if (!taskId) continue;
    const events = (await readStateObjects(deps, `deployment-events/${taskId}/`))
      .sort((left, right) => stateTimestamp(left) - stateTimestamp(right));
    for (let index = 0; index < events.length - 1; index += 1) {
      const current = events[index]!;
      const next = events[index + 1]!;
      const step = typeof current.step === 'string' ? current.step : 'unknown';
      const duration = stateTimestamp(next) - stateTimestamp(current);
      if (duration >= 0) stepDurations.set(step, [...(stepDurations.get(step) ?? []), duration]);
    }
  }

  const subscriptionJobs = (await readStateObjects(deps, 'subscription-jobs/')).filter(item => stateTimestamp(item) >= cutoff);
  const completedJobs = subscriptionJobs.filter(item => ['succeeded', 'partial', 'failed'].includes(String(item.status)));
  const sourceTotals = completedJobs.reduce((total, item) => total + number(item.sourcesTotal), 0);
  const sourceSucceeded = completedJobs.reduce((total, item) => total + number(item.sourcesSucceeded), 0);

  const snapshots = samples.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
  const onlineRates = snapshots.flatMap(item => number(item.enabledNodes) > 0 ? [number(item.onlineNodes) / number(item.enabledNodes)] : []);
  const artifactAges: number[] = snapshots.flatMap(item => {
    const artifacts = item.artifacts && typeof item.artifacts === 'object' ? item.artifacts as Record<string, unknown> : {};
    return Object.values(artifacts).flatMap(artifact => {
      const age = artifact && typeof artifact === 'object' ? (artifact as Record<string, unknown>).ageSeconds : undefined;
      return typeof age === 'number' && Number.isFinite(age) ? [age] : [];
    });
  });

  return {
    deploymentSuccessRate: rate(successfulDeployments, completedDeployments.length),
    deploymentCompleted: completedDeployments.length,
    deploymentAverageDurationMs: average(deploymentDurations),
    deploymentStepAverageDurationMs: Object.fromEntries([...stepDurations].map(([step, values]) => [step, average(values)])),
    agentOnlineRate: rate(onlineRates.reduce((sum, value) => sum + value, 0), onlineRates.length),
    sourceSuccessRate: rate(sourceSucceeded, sourceTotals),
    subscriptionSuccessRate: rate(completedJobs.filter(item => item.status === 'succeeded' || item.status === 'partial').length, completedJobs.length),
    subscriptionJobs: completedJobs.length,
    artifactAverageAgeSeconds: average(artifactAges),
    artifactMaximumAgeSeconds: artifactAges.length ? Math.max(...artifactAges) : null,
  };
}

async function readStateObjects(deps: DashboardServerDependencies, prefix: string): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  for (const key of await deps.core.state.listKeys(prefix)) {
    const raw = await deps.core.state.get(key);
    if (!raw) continue;
    try {
      const value = JSON.parse(raw) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) records.push(value as Record<string, unknown>);
    } catch { /* Ignore malformed state records. */ }
  }
  return records;
}

function stateTimestamp(value: Record<string, unknown>): number {
  if (typeof value.startedAt === 'number') return value.startedAt;
  return Date.parse(String(value.createdAt ?? value.timestamp ?? '')) || 0;
}
function number(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function average(values: number[]): number | null { return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null; }
function rate(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function openApiDocument(req: DashboardRequest): Record<string, unknown> {
  const paths = [
    ['Nodes', 'GET', '/api/cluster/status', '查询节点与运行时聚合状态'],
    ['Nodes', 'POST', '/api/cluster/nodes', '创建节点档案'],
    ['Nodes', 'PATCH', '/api/cluster/nodes/{id}', '更新节点档案'],
    ['Nodes', 'DELETE', '/api/cluster/nodes/{id}', '删除节点档案'],
    ['Nodes', 'POST', '/api/cluster/nodes/{id}/preflight', '执行节点 SSH 预检'],
    ['Components', 'GET', '/api/cluster/components', '查询组件安装态、运行态和监控态'],
    ['Components', 'POST', '/api/cluster/components/detect', '检测协议核心'],
    ['Components', 'POST', '/api/cluster/components/{component}/{action}', '启动、停止或重启组件'],
    ['Components', 'PUT', '/api/cluster/components/{component}/monitoring', '事务更新 Agent 监控配置'],
    ['Deployments', 'POST', '/api/deployments/preflight', '执行部署预检'],
    ['Deployments', 'POST', '/api/deployments', '创建单节点组件部署任务'],
    ['Deployments', 'GET', '/api/deployments', '查询部署任务'],
    ['Deployments', 'GET', '/api/deployments/{id}', '查询一个部署任务'],
    ['Deployments', 'POST', '/api/deployments/{id}/cancel', '取消尚未写入的任务'],
    ['Deployments', 'POST', '/api/deployments/{id}/retry', '按原输入重试任务'],
    ['Deployments', 'GET', '/api/deployments/{id}/events', '订阅部署 SSE 事件'],
    ['Deployments', 'GET', '/api/deployments/{id}/logs', '读取部署任务日志'],
    ['Deployments', 'GET', '/api/deployments/agent/manual-config', '下载手动安装 Agent 配置'],
    ['Subscriptions', 'POST', '/api/subscription-jobs/preflight', '预检订阅来源'],
    ['Subscriptions', 'POST', '/api/subscription-jobs', '创建正式订阅任务'],
    ['Subscriptions', 'GET', '/api/subscription-jobs', '查询订阅任务历史'],
    ['Subscriptions', 'GET', '/api/subscription-jobs/{id}', '查询一个订阅任务'],
    ['Subscriptions', 'POST', '/api/subscription-jobs/{id}/retry', '重试订阅任务'],
    ['Subscriptions', 'GET', '/api/subscription-jobs/{id}/events', '订阅生成 SSE 事件'],
    ['Artifacts', 'GET', '/api/artifacts', '查询正式产物状态'],
    ['Artifacts', 'GET', '/api/artifacts/{name}/preview', '预览正式产物'],
    ['Artifacts', 'POST', '/api/artifacts/validate', '验证正式产物'],
    ['Subscriptions', 'GET', '/api/subscription-policy', '读取订阅策略'],
    ['Subscriptions', 'PUT', '/api/subscription-policy', '保存订阅策略'],
    ['Configuration', 'GET', '/api/config/schema', '查询配置字段定义'],
    ['Configuration', 'GET', '/api/config/effective', '查询当前生效配置'],
    ['Configuration', 'POST', '/api/config/validate', '验证配置草稿'],
    ['Configuration', 'PATCH', '/api/config', '原子更新一个或多个配置字段'],
    ['Configuration', 'POST', '/api/config/restore', '恢复 last-good 配置'],
    ['Configuration', 'GET', '/api/config/export', '导出脱敏配置'],
    ['Configuration', 'POST', '/api/config/import/preview', '预览配置导入差异'],
    ['Observability', 'GET', '/api/logs', '聚合查询控制面、Agent 与任务日志'],
    ['Observability', 'GET', '/api/diagnostics', '查询配置、组件、来源与产物诊断快照'],
    ['Observability', 'GET', '/api/metrics', '查询指标快照与趋势'],
    ['Notifications', 'POST', '/api/notifications/test', '发送 Webhook 测试通知'],
    ['Notifications', 'GET', '/api/notifications/history', '查询通知投递历史'],
    ['Compatibility', 'GET', '/health', '公共健康检查'],
    ['Compatibility', 'GET', '/raw.txt', '原始节点产物'],
    ['Compatibility', 'GET', '/subscription.txt', 'Base64 订阅产物'],
    ['Compatibility', 'GET', '/clash.yaml', 'Clash YAML 产物'],
    ['Compatibility', 'GET', '/api/update', '兼容订阅生成端点'],
  ] as const;
  return {
    openapi: '3.1.0', info: { title: 'MioBridge API', version: '1.0.0' },
    servers: [{ url: `http://${header(req, 'host') ?? 'localhost'}` }],
    paths: paths.reduce<Record<string, Record<string, unknown>>>((document, [tag, method, path, summary]) => {
      document[path] = { ...(document[path] ?? {}), [method.toLowerCase()]: { tags: [tag], summary, responses: { [method === 'POST' && (path === '/api/deployments' || path === '/api/subscription-jobs') ? 202 : 200]: { description: '成功' } } } };
      return document;
    }, {}),
  };
}

class RequestFieldError extends Error { constructor(readonly field: string, message: string) { super(message); } }
function fieldError(field: string, message: string): RequestFieldError { return new RequestFieldError(field, message); }
