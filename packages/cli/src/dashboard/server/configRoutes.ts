import type { DashboardRouteRegistrar, DashboardServerDependencies } from './composition.js';
import type { DashboardRequest, DashboardResponse } from './http.js';

const NOW = () => new Date().toISOString();

/**
 * Register config, logs, YAML, convert, and diagnose routes.
 */
export function registerConfigRoutes(
  registrar: DashboardRouteRegistrar,
  deps: DashboardServerDependencies,
): void {
  // ── Configs ────────────────────────────────────────────────────────

  // GET /api/configs
  registrar.register({
    method: 'GET',
    path: '/api/configs',
    handler: (_req: DashboardRequest, res: DashboardResponse) => {
      const result = deps.config.getConfigs();
      res.json(result);
    },
  });

  // POST /api/configs
  registrar.register({
    method: 'POST',
    path: '/api/configs',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      try {
        const { configs } = (req.body as Record<string, unknown>) || {};
        if (!Array.isArray(configs)) {
          res.status(400).json({ success: false, error: '请提供有效的configs数组', timestamp: NOW() });
          return;
        }
        if (configs.length === 0) {
          res.status(400).json({ success: false, error: '配置列表不能为空', timestamp: NOW() });
          return;
        }
        const result = await deps.config.updateConfigs(configs as string[]);
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, error: msg, timestamp: NOW() });
      }
    },
  });

  // ── Logs ───────────────────────────────────────────────────────────

  // GET /api/logs?source=&node=&component=&taskId=&file=&level=&from=&to=&q=
  registrar.register({
    method: 'GET',
    path: '/api/logs',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      try {
        const value = (name: string) => typeof req.query?.[name] === 'string' ? req.query[name].trim() : '';
        const source = value('source') || (value('node') && value('node') !== 'local' ? 'agent' : 'control');
        const nodeId = value('node');
        const taskId = value('taskId') || value('task');
        const level = value('level');
        const query = value('q');
        const component = value('component');
        const file = value('file');
        const from = parseTime(value('from'));
        const to = parseTime(value('to'));
        let result: { success: boolean; data?: unknown; error?: string; statusCode?: number; timestamp?: string };
        if (source === 'control') {
          const local = await deps.core.getLocalLogs({ lines: 10_000, ...(level && level !== 'all' ? { level } : {}) });
          const entries = local.entries.filter(entry => (!file || entry.file === file) && lineMatches(entry.content, query, component, from, to));
          result = { success: true, data: { source, file: file || entries.at(-1)?.file || local.files.at(-1) || '', files: local.files, lines: entries.slice(-2000).map(entry => entry.content), updatedAt: local.updatedAt, nodeId: 'local', nodeName: '控制面' }, timestamp: NOW() };
        } else if (source === 'deployment') {
          if (!taskId) throw new Error('部署任务日志需要 taskId');
          const task = await deps.operations.getDeploymentLog(taskId);
          const content = task.success ? String((task.data as { content?: string } | undefined)?.content ?? '') : '';
          result = task.success
            ? { success: true, data: taskLogResult('deployment', taskId, content, level, query, component, from, to), timestamp: NOW() }
            : task;
        } else if (source === 'subscription') {
          if (!taskId) throw new Error('订阅任务日志需要 taskId');
          const events = await deps.subscription.events(taskId);
          const lines = events.success
            ? ((events.data as { events?: Array<Record<string, unknown>> } | undefined)?.events ?? []).map(event => JSON.stringify(event))
            : [];
          result = events.success
            ? { success: true, data: taskLogResult('subscription', taskId, lines.join('\n'), level, query, component, from, to), timestamp: NOW() }
            : events;
        } else {
          if (!nodeId || nodeId === 'local') throw new Error('Agent 日志需要子节点');
          result = await deps.config.getRemoteLogs(nodeId, {
            ...(file ? { file } : {}), ...(level ? { level } : {}),
            query: [query, component, taskId].filter(Boolean).join(' '),
          });
          if (result.success && result.data && typeof result.data === 'object') {
            const data = result.data as { lines?: string[] };
            data.lines = (data.lines ?? []).filter(line => lineMatches(line, '', '', from, to));
          }
        }
        // 日志响应同样是规范 ApiEnvelope 的一部分，role 不能缺席。
        if (result.success) {
          res.json({ success: true, data: result.data, timestamp: result.timestamp ?? NOW(), requestId: req.requestId, role: 'admin' });
        } else {
          res.status(result.statusCode ?? 502).json({
            success: false,
            error: { code: 'LOG_QUERY_FAILED', message: result.error ?? '日志读取失败', retryable: true },
            timestamp: result.timestamp ?? NOW(), requestId: req.requestId, role: 'admin',
          });
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ success: false, error: { code: 'INVALID_LOG_QUERY', message: msg, retryable: false }, timestamp: NOW(), requestId: req.requestId, role: 'admin' });
      }
    },
  });

  // ── YAML ───────────────────────────────────────────────────────────

  // GET /api/yaml/config
  registrar.register({
    method: 'GET',
    path: '/api/yaml/config',
    handler: (_req: DashboardRequest, res: DashboardResponse) => {
      try {
        const result = deps.yaml.getFullConfig();
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, message: msg });
      }
    },
  });

  // GET /api/yaml/frontend
  registrar.register({
    method: 'GET',
    path: '/api/yaml/frontend',
    handler: (_req: DashboardRequest, res: DashboardResponse) => {
      try {
        const result = deps.yaml.getFrontendConfig();
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, message: msg });
      }
    },
  });

  // POST /api/yaml/generate
  registrar.register({
    method: 'POST',
    path: '/api/yaml/generate',
    handler: async (req: DashboardRequest, res: DashboardResponse) => {
      const { templatePath, outputPath } = (req.body as Record<string, unknown>) || {};
      if (!templatePath || typeof templatePath !== 'string') {
        res.status(400).json({ success: false, message: '请提供模板文件路径 (templatePath)' });
        return;
      }
      try {
        const result = await deps.yaml.generateConfig(templatePath, typeof outputPath === 'string' ? outputPath : undefined);
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, message: msg });
      }
    },
  });

  // GET /api/yaml/validate
  registrar.register({
    method: 'GET',
    path: '/api/yaml/validate',
    handler: (_req: DashboardRequest, res: DashboardResponse) => {
      try {
        const result = deps.yaml.validateConfig();
        res.json(result);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ success: false, message: msg });
      }
    },
  });
}

function taskLogResult(source: string, taskId: string, content: string, level: string, query: string, component: string, from?: number, to?: number) {
  const lines = content.split(/\r?\n/).filter(Boolean).filter(line => {
    const levelMatches = !level || level === 'all' || new RegExp(`\\b${escapeRegExp(level)}\\b`, 'i').test(line);
    return levelMatches && lineMatches(line, query, component, from, to);
  });
  return { source, file: `${taskId}.log`, files: [`${taskId}.log`], lines: lines.slice(-2000), updatedAt: NOW(), taskId };
}

function lineMatches(line: string, query: string, component: string, from?: number, to?: number): boolean {
  if (query && !line.toLowerCase().includes(query.toLowerCase())) return false;
  if (component && !line.toLowerCase().includes(component.toLowerCase())) return false;
  if (from === undefined && to === undefined) return true;
  const timestamp = lineTimestamp(line);
  if (timestamp === undefined) return false;
  return (from === undefined || timestamp >= from) && (to === undefined || timestamp <= to);
}

function lineTimestamp(line: string): number | undefined {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    const candidate = value.timestamp ?? value.time ?? value.createdAt;
    if (typeof candidate === 'string') { const parsed = Date.parse(candidate); if (Number.isFinite(parsed)) return parsed; }
  } catch { /* Plain-text logs are parsed below. */ }
  const candidate = line.match(/\d{4}-\d{2}-\d{2}[T ][0-9:.+-]+Z?/)?.[0];
  if (!candidate) return undefined;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTime(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`无效时间: ${value}`);
  return parsed;
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
