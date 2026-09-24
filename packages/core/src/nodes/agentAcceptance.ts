import type { AgentClient } from './agentClient.js';
import type { NodeConfig } from './types.js';

export interface AgentDeploymentAcceptanceOptions {
  stabilizationMs?: number;
  timeoutMs?: number;
  diagnosticTimeoutMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}

export interface AgentDeploymentAcceptanceResult { version: string; checkedAt: string }

export interface AgentDeploymentDiagnostics {
  lingerEnabled?: boolean;
  serviceState?: string;
  portConflict?: boolean;
  journal?: string;
  healthError?: string;
  diagnosticError?: string;
}

export type AgentDeploymentErrorCode = 'LINGER_DISABLED' | 'SERVICE_NOT_STARTED' | 'PORT_CONFLICT'
  | 'HEALTH_TIMEOUT' | 'VERSION_MISMATCH' | 'HEALTH_UNREACHABLE' | 'UNHEALTHY';

const FAILURE_REASONS: Record<AgentDeploymentErrorCode, string> = {
  LINGER_DISABLED: 'Linger 未启用；请启用运行用户的持久服务后重试',
  SERVICE_NOT_STARTED: 'Agent 服务未启动或已退出；请检查服务日志并修复启动错误',
  PORT_CONFLICT: 'Agent 端口冲突；请释放监听端口或修改 Agent 端口',
  HEALTH_TIMEOUT: '公开健康接口超时；请检查防火墙、监听端口和网络连通性',
  VERSION_MISMATCH: 'Agent 版本不符；请检查运行中的二进制和服务路径',
  HEALTH_UNREACHABLE: '断开 SSH 后公开健康接口不可达；请检查服务状态和网络连通性',
  UNHEALTHY: 'Agent 健康状态异常；请检查服务日志',
};

export class AgentDeploymentError extends Error {
  override readonly name = 'AgentDeploymentError';
  constructor(readonly code: AgentDeploymentErrorCode, message: string, readonly diagnostics: AgentDeploymentDiagnostics = {}) {
    super(message);
  }
}

export function redactAgentDiagnostic(value: string, secrets: readonly (string | undefined)[] = []): string {
  let result = value.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[redacted]');
  for (const secret of secrets) if (secret) result = result.split(secret).join('[redacted]');
  return result.replace(/((?:password|secret|token|authorization|x-signature)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[redacted]');
}

/** Public health/version acceptance runs after the caller closes its mutation session. */
export class AgentDeploymentAcceptance {
  constructor(private readonly client: AgentClient, private readonly options: AgentDeploymentAcceptanceOptions = {}) {}

  async verify(node: NodeConfig, expectedVersion: string, lifecycle: {
    disconnect(): void | Promise<void>;
    diagnose?(signal: AbortSignal): Promise<AgentDeploymentDiagnostics>;
    sensitiveValues?: readonly string[];
  }): Promise<AgentDeploymentAcceptanceResult> {
    await lifecycle.disconnect();
    await (this.options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))))(this.options.stabilizationMs ?? 2_000);
    try {
      const health = await this.client.get(node, '/health', this.options.timeoutMs ?? 10_000) as Record<string, unknown> | null;
      if (!health || health.status !== 'healthy') throw new AgentDeploymentError('UNHEALTHY', 'Agent 未返回 healthy 状态');
      if (!expectedVersion || health.version !== expectedVersion) {
        throw new AgentDeploymentError('VERSION_MISMATCH', `目标版本 ${expectedVersion || '(缺失)'}，实际版本 ${typeof health.version === 'string' ? health.version : '(缺失)'}`);
      }
      return { version: expectedVersion, checkedAt: new Date().toISOString() };
    } catch (error) {
      const clean = (value: string) => redactAgentDiagnostic(value, [node.secret, node.ssh?.password, ...lifecycle.sensitiveValues ?? []]);
      let observed: AgentDeploymentDiagnostics = {};
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (lifecycle.diagnose) observed = await Promise.race([
          lifecycle.diagnose(controller.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error('SSH 诊断超时')); }, this.options.diagnosticTimeoutMs ?? 5_000);
          }),
        ]);
      }
      catch (diagnosticError) { observed.diagnosticError = diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError); }
      finally { clearTimeout(timer); }
      const diagnostics: AgentDeploymentDiagnostics = {
        ...observed,
        healthError: clean(error instanceof Error ? error.message : String(error)),
        ...(observed.serviceState ? { serviceState: clean(observed.serviceState) } : {}),
        ...(observed.journal ? { journal: clean(observed.journal) } : {}),
        ...(observed.diagnosticError ? { diagnosticError: clean(observed.diagnosticError) } : {}),
      };
      const code: AgentDeploymentErrorCode = error instanceof AgentDeploymentError ? error.code
        : observed.portConflict ? 'PORT_CONFLICT'
        : observed.lingerEnabled === false ? 'LINGER_DISABLED'
          : observed.serviceState && observed.serviceState !== 'active' ? 'SERVICE_NOT_STARTED'
            : error instanceof Error && error.name === 'AbortError' ? 'HEALTH_TIMEOUT' : 'HEALTH_UNREACHABLE';
      const reason = FAILURE_REASONS[code];
      throw new AgentDeploymentError(code, `${reason}: ${diagnostics.healthError}${diagnostics.journal ? `\n${diagnostics.journal}` : ''}`, diagnostics);
    }
  }
}
