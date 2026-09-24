import type { NodeConfig } from './types.js';

export interface NodeDiagnosticCheck {
  readonly key: string;
  readonly label: string;
  readonly status: 'pass' | 'warning' | 'fail';
  readonly reason: string;
  readonly suggestion?: string;
  readonly repairable: boolean;
}
export interface NodeDiagnosticsReport {
  readonly nodeId: string;
  readonly checkedAt: string;
  readonly serviceMode: 'user' | 'system';
  readonly runtimeUser: string;
  readonly version: string;
  readonly healthy: boolean;
  readonly checks: readonly NodeDiagnosticCheck[];
}
export interface NodeServiceMigration {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
export interface NodeMaintenancePort {
  inspect(node: NodeConfig): Promise<NodeDiagnosticsReport>;
  repair(node: NodeConfig, report: NodeDiagnosticsReport): Promise<void>;
  /** Stage, validate and hand over, retaining enough state to restore the old service. */
  beginMigration(node: NodeConfig, runtimeUser: string): Promise<NodeServiceMigration>;
}
export interface NodeMaintenanceServiceOptions {
  readonly port: NodeMaintenancePort;
  /** Runs only after the mutation's SSH session has closed. */
  readonly accept: (node: NodeConfig, expectedVersion: string) => Promise<unknown>;
  readonly now?: () => Date;
  readonly withLock?: <T>(nodeId: string, action: () => Promise<T>) => Promise<T>;
}

export class NodeMaintenanceService {
  private readonly busy = new Set<string>();
  constructor(private readonly options: NodeMaintenanceServiceOptions) {}

  async diagnose(node: NodeConfig): Promise<NodeDiagnosticsReport> {
    try {
      const report = await this.options.port.inspect(node);
      return { ...report, version: this.message(report.version, node), checks: report.checks.map(check => ({
        ...check, reason: this.message(check.reason, node),
        ...(check.suggestion ? { suggestion: this.message(check.suggestion, node) } : {}),
      })) };
    } catch (error) { throw new Error(this.message(error, node)); }
  }

  async repair(node: NodeConfig): Promise<NodeDiagnosticsReport> {
    return this.exclusive(node, async () => {
      const before = await this.diagnose(node);
      if (before.checks.some(check => check.status === 'fail' && check.repairable)) {
        await this.options.port.repair(node, before);
      }
      if (!before.version) throw new Error('无法确定 Agent 版本；请先安装或升级 Agent 后重新体检');
      await this.options.accept(node, before.version);
      const after = await this.diagnose(node);
      if (!after.healthy) throw new Error(`修复后的体检仍未通过：${after.checks.filter(check => check.status === 'fail').map(check => `${check.label}: ${check.reason}`).join('；')}`);
      return after;
    });
  }

  async migrate(node: NodeConfig, runtimeUser: string): Promise<NodeDiagnosticsReport> {
    return this.exclusive(node, async () => {
      if (!/^[a-z_][a-z0-9_-]*[$]?$/i.test(runtimeUser) || runtimeUser === 'root') throw new Error('请指定已存在的非 root 运行用户');
      const before = await this.diagnose(node);
      if (before.serviceMode === 'system') throw new Error('节点已经使用系统级服务，请使用体检或修复');
      if (!before.version) throw new Error('无法确定 Agent 版本；请先安装或升级 Agent');
      const transaction = await this.options.port.beginMigration(node, runtimeUser);
      try {
        await this.options.accept(node, before.version);
        const after = await this.diagnose(node);
        if (!after.healthy) throw new Error(`迁移后的系统级服务体检未通过：${after.checks.filter(check => check.status === 'fail').map(check => `${check.label}: ${check.reason}`).join('；')}`);
        await transaction.commit();
        return after;
      } catch (error) {
        try {
          await transaction.rollback();
          if (before.checks.some(check => check.key === 'running' && check.status === 'pass')) {
            await this.options.accept(node, before.version);
          }
        }
        catch (rollbackError) { throw new Error(`${this.message(error, node)}；回滚失败：${this.message(rollbackError, node)}`); }
        throw new Error(`${this.message(error, node)}；已恢复迁移前的用户级服务`);
      }
    });
  }

  private async exclusive<T>(node: NodeConfig, action: () => Promise<T>): Promise<T> {
    if (this.busy.has(node.id)) throw new Error('节点正在进行维护，请等待当前操作完成');
    this.busy.add(node.id);
    try { return await (this.options.withLock ? this.options.withLock(node.id, action) : action()); }
    catch (error) { throw new Error(this.message(error, node)); }
    finally { this.busy.delete(node.id); }
  }
  private message(error: unknown, node: NodeConfig): string {
    let message = error instanceof Error ? error.message : String(error);
    for (const secret of [node.secret, node.ssh?.password].filter((value): value is string => Boolean(value))) message = message.split(secret).join('[REDACTED]');
    return message;
  }
}
