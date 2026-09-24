import { Buffer } from 'node:buffer';
import { type NodeMaintenanceService, redactAgentDiagnostic, type NodeConfig, type NodeDiagnosticCheck, type NodeDiagnosticsReport, type NodeMaintenancePort, type NodeServiceMigration } from '@miobridge/core';
import type { NodeCoreComposition } from '../../../composition.js';
import { agentYaml, replaceAgentConfig, systemdUnit } from './agent.js';
import { AGENT_SERVICE_RECEIPT, AGENT_SYSTEM_UNIT, detectAgentService, runtimeSystemctl, systemAgentUnit, systemAgentRuntime, validRuntimeUser, type AgentServiceRuntime } from './agentRuntime.js';
import { diagnoseAgent } from './agentAcceptance.js';
import { NodeTargets } from './targets.js';
import { SshTransport } from './transport.js';
import type { DeploymentConnection, DeploymentServiceOptions, ExecResult, SshTarget } from './types.js';
import { shellQuote, userSystemctl } from './util.js';
import { withNodeMutation } from './nodeMutationLock.js';

function encoded(value: string): string { return shellQuote(Buffer.from(value).toString('base64')); }
function clean(error: unknown, target?: SshTarget): string {
  return redactAgentDiagnostic(error instanceof Error ? error.message : String(error), [target?.secret, target?.ssh.password, target?.ssh.privateKey, ...(target ? [Buffer.from(agentYaml(target, target.kernels)).toString('base64')] : [])]);
}
function check(key: string, label: string, ok: boolean, reason: string, suggestion: string, repairable: boolean, warning = false): NodeDiagnosticCheck {
  return { key, label, status: ok ? 'pass' : warning ? 'warning' : 'fail', reason, ...(ok ? {} : { suggestion }), repairable: !ok && repairable };
}
function properties(value: string): Record<string, string> { return Object.fromEntries(value.trim().split('\n').map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; })); }

/** Linux commands are confined to this CLI adapter; the core controls acceptance and rollback. */
export class SshNodeMaintenance implements NodeMaintenancePort {
  private readonly transport: SshTransport;
  private readonly targets: NodeTargets;
  constructor(private readonly composition: NodeCoreComposition, options: DeploymentServiceOptions = {}, transport = new SshTransport(options)) {
    this.transport = transport;
    this.targets = new NodeTargets(composition);
  }

  async inspect(node: NodeConfig): Promise<NodeDiagnosticsReport> {
    const checks: NodeDiagnosticCheck[] = [];
    let runtime: AgentServiceRuntime | undefined;
    let target: SshTarget | undefined;
    let ssh: DeploymentConnection | undefined;
    let version = '';
    try {
      target = await this.targets.forNode(node.id);
      ssh = await this.transport.connect(target);
      runtime = await detectAgentService(this.transport, ssh);
      checks.push(check('ssh', target.local ? '本机执行' : 'SSH 连接', true, '连接正常', '', false));
      const linger = runtime.mode === 'system' ? undefined : await this.transport.exec(ssh, `loginctl show-user ${shellQuote(runtime.user)} --property=Linger --value`);
      checks.push(check('linger', 'Linger', runtime.mode === 'system' || (linger?.code === 0 && linger.stdout.trim() === 'yes'), runtime.mode === 'system' ? '系统级服务独立于登录会话，无需 Linger' : linger?.stdout.trim() === 'yes' ? '已启用' : '用户服务将在退出登录后失去持久运行保障', `启用用户 ${runtime.user} 的 Linger`, true));
      const state = await this.transport.exec(ssh, runtimeSystemctl(runtime, 'show', 'miobridge-agent.service', '--property=UnitFileState,ActiveState,NRestarts,LoadState'));
      const values = properties(state.stdout);
      checks.push(check('unit', '服务配置', values.LoadState === 'loaded', values.LoadState || clean(state.stderr || '服务未加载', target), '重新生成 Agent unit 并重新加载 systemd', true));
      checks.push(check('enabled', '开机启动', values.UnitFileState === 'enabled', values.UnitFileState || '未启用', '启用 Agent 服务', true));
      checks.push(check('running', 'Agent 服务', values.ActiveState === 'active', values.ActiveState || '状态未知', '启动 Agent，并检查启动错误', true));
      const restarts = Number(values.NRestarts);
      checks.push(check('restarts', '重启次数', Number.isFinite(restarts) && restarts === 0, Number.isFinite(restarts) ? `${restarts} 次` : '无法读取重启次数', '检查 Agent 日志和资源限制，查明反复重启原因', false, true));
      const binary = await this.transport.exec(ssh, `${shellQuote(runtime.binaryPath)} --version`);
      version = binary.code === 0 ? binary.stdout.trim() : '';
      checks.push(check('version', 'Agent 版本', Boolean(version), version || clean(binary.stderr || 'Agent 二进制不存在或无法执行', target), '安装或升级 Agent 后重试', false));
      const expected = agentYaml(target, target.kernels);
      const configCommand = `${shellQuote(runtime.binaryPath)} --check-config ${shellQuote(runtime.configPath)} >/dev/null && cmp -s ${shellQuote(runtime.configPath)} <(printf %s ${encoded(expected)} | base64 -d)`;
      const config = runtime.mode === 'system' ? await this.transport.execRoot(ssh, target, `bash -c ${shellQuote(configCommand)}`) : await this.transport.exec(ssh, `bash -c ${shellQuote(configCommand)}`);
      checks.push(check('config', 'Agent 配置', config.code === 0, config.code === 0 ? '配置有效且与节点档案一致' : '配置无效、权限异常或与节点档案不一致', '按当前节点档案恢复配置并重新启动', Boolean(version)));
    } catch (error) {
      checks.push(check(checks.length ? 'diagnostics' : 'ssh', checks.length ? '诊断命令' : node.id === 'local' ? '本机执行' : 'SSH 连接', false, clean(error, target), '检查节点 SSH 主机、端口、凭据、主机指纹和用户权限', false));
    } finally { await ssh?.end(); }
    try {
      const health = await this.composition.agent.get(node, '/health') as Record<string, unknown>;
      const ok = health?.status === 'healthy';
      checks.push(check('health', '公开健康接口', ok, ok ? '公开 HTTP + HMAC 健康检查通过' : '健康接口未返回 healthy', '检查 Agent、端口、防火墙和公开地址', false));
      if (ok && version && health.version !== version) checks.push(check('version-match', '运行版本一致性', false, `二进制版本 ${version} 与公开接口版本 ${String(health.version ?? '未知')} 不同`, '重启 Agent 使新二进制生效', true));
    } catch (error) { checks.push(check('health', '公开健康接口', false, clean(error, target), '检查 Agent、端口、防火墙和公开地址；SSH 连接与 Agent 健康是独立检查', false)); }
    return { nodeId: node.id, checkedAt: new Date().toISOString(), serviceMode: runtime?.mode ?? node.agent?.serviceMode ?? 'user', runtimeUser: runtime?.user ?? node.agent?.runtimeUser ?? node.ssh?.user ?? '', version: clean(version, target), healthy: !checks.some(item => item.status === 'fail'), checks: checks.map(item => ({ ...item, reason: clean(item.reason, target) })) };
  }

  async repair(node: NodeConfig, report: NodeDiagnosticsReport): Promise<void> {
    await this.connected(node, async (ssh, target) => {
      const runtime = await detectAgentService(this.transport, ssh);
      const failed = new Set(report.checks.filter(item => item.status === 'fail' && item.repairable).map(item => item.key));
      const execute = (command: string) => runtime.mode === 'system' ? this.root(ssh, target, command) : this.run(ssh, target, command);
      if (failed.has('linger') && runtime.mode === 'user') await this.root(ssh, target, `loginctl enable-linger ${shellQuote(runtime.user)}`);
      if (failed.has('unit')) {
        const unit = runtime.mode === 'system' ? systemAgentUnit(runtime) : systemdUnit();
        await execute(`mkdir -p ${shellQuote(runtime.unitPath.slice(0, runtime.unitPath.lastIndexOf('/')))} && printf %s ${encoded(unit)} | base64 -d > ${shellQuote(runtime.unitPath)} && chmod 644 ${shellQuote(runtime.unitPath)}`);
        await execute(runtimeSystemctl(runtime, 'daemon-reload'));
      }
      if (failed.has('config')) await replaceAgentConfig(this.transport, ssh, agentYaml(target, target.kernels), target);
      if (failed.has('enabled') || failed.has('unit')) await execute(runtimeSystemctl(runtime, 'enable', 'miobridge-agent.service'));
      if (failed.has('config') || failed.has('unit') || failed.has('version-match')) await execute(runtimeSystemctl(runtime, 'restart', 'miobridge-agent.service'));
      else if (failed.has('running')) await execute(runtimeSystemctl(runtime, 'start', 'miobridge-agent.service'));
    });
  }

  async beginMigration(node: NodeConfig, runtimeUser: string): Promise<NodeServiceMigration> {
    if (!validRuntimeUser(runtimeUser)) throw new Error('请指定已存在的非 root 运行用户');
    let previous: { enabled: boolean; active: boolean } | undefined;
    let previousVersion = '';
    let mutated = false;
    let runtime: AgentServiceRuntime | undefined;
    const rollback = async () => {
      if (!mutated || !previous) return;
      await this.connected(node, async (ssh, target) => {
        await this.root(ssh, target, [
          'set -e',
          `if test -f ${shellQuote(AGENT_SYSTEM_UNIT)}; then`,
          '  systemctl stop miobridge-agent.service',
          '  if systemctl is-active --quiet miobridge-agent.service; then echo "系统级 Agent 未停止，保留迁移文件以便诊断" >&2; exit 1; fi',
          '  systemctl disable miobridge-agent.service',
          'fi',
          'if test -f /run/systemd/system/miobridge-agent-candidate.service; then',
          '  systemctl stop miobridge-agent-candidate.service',
          '  if systemctl is-active --quiet miobridge-agent-candidate.service; then echo "候选 Agent 未停止，保留迁移文件以便诊断" >&2; exit 1; fi',
          'fi',
          `rm -f ${shellQuote(AGENT_SYSTEM_UNIT)} ${shellQuote(AGENT_SERVICE_RECEIPT)} /run/systemd/system/miobridge-agent-candidate.service`,
          'systemctl daemon-reload',
          `rm -f ${shellQuote(runtime!.configPath)} ${shellQuote(`${runtime!.configPath}.candidate`)} ${shellQuote(runtime!.binaryPath)}`,
        ].join('\n'));
        await this.run(ssh, target, `${userSystemctl(previous!.enabled ? 'enable' : 'disable', 'miobridge-agent.service')} && ${userSystemctl(previous!.active ? 'start' : 'stop', 'miobridge-agent.service')}`);
        if (previous!.active) {
          await this.run(ssh, target, userSystemctl('is-active', '--quiet', 'miobridge-agent.service'));
          const response = await this.run(ssh, target, `for attempt in $(seq 1 20); do if curl --max-time 2 -fsS http://127.0.0.1:${target.agentPort}/health; then exit 0; fi; sleep 0.25; done; exit 1`);
          let health: Record<string, unknown>;
          try { health = JSON.parse(response.stdout) as Record<string, unknown>; } catch { throw new Error('原用户服务恢复后健康响应无效'); }
          if (health.status !== 'healthy' || health.version !== previousVersion) throw new Error('原用户服务恢复后的健康或版本验收失败');
          await this.run(ssh, target, userSystemctl('is-active', '--quiet', 'miobridge-agent.service'));
        }
      });
    };
    try {
      await this.connected(node, async (ssh, target) => {
        const source = await detectAgentService(this.transport, ssh);
        if (source.mode === 'system') throw new Error('节点已经使用系统级服务');
        const privilege = await this.transport.execRoot(ssh, target, 'id -u');
        if (privilege.code !== 0 || privilege.stdout.trim() !== '0') throw new Error(`迁移需要 root 或可用的 sudo 提权；请为 SSH 用户配置 sudo 权限。${clean(privilege.stderr, target)}`);
        const account = await this.root(ssh, target, `getent passwd ${shellQuote(runtimeUser)}`);
        const fields = account.stdout.trim().split(':');
        const home = fields[5] ?? '';
        if (fields[0] !== runtimeUser || !fields[2] || fields[2] === '0' || !/^\/[a-zA-Z0-9_./-]+$/.test(home)) throw new Error('运行用户不存在、属于 UID 0 或 home 路径不受支持；请先创建非特权用户');
        runtime = { ...systemAgentRuntime(runtimeUser, home), sourceUser: source.user, sourceHome: source.home };
        await this.root(ssh, target, `test ! -e ${shellQuote(AGENT_SYSTEM_UNIT)} && test ! -e ${shellQuote(runtime.configPath)} && test ! -e ${shellQuote(runtime.binaryPath)} && test ! -e /run/systemd/system/miobridge-agent-candidate.service && command -v ss >/dev/null && command -v curl >/dev/null && command -v runuser >/dev/null`);
        await this.root(ssh, target, 'if systemctl cat miobridge-agent.service >/dev/null 2>&1; then echo "已存在系统级 Agent 服务，请先由管理员检查；迁移未修改服务" >&2; exit 1; fi');
        const state = properties((await this.run(ssh, target, `${userSystemctl('show', 'miobridge-agent.service', '--property=UnitFileState,ActiveState')}`)).stdout);
        previous = { enabled: state.UnitFileState === 'enabled', active: state.ActiveState === 'active' };
        const version = (await this.run(ssh, target, `${shellQuote(source.binaryPath)} --version`)).stdout.trim();
        previousVersion = version;
        if (!version) throw new Error('Agent 二进制版本缺失，请先升级 Agent');
        mutated = true;
        const staged = await this.root(ssh, target, [
          'set -eu', 'mkdir -p /etc/miobridge-agent /run/systemd/system',
          `runuser -u ${shellQuote(runtimeUser)} -- mkdir -p ${shellQuote(`${home}/.config/miobridge/bin`)} ${shellQuote(`${home}/.config/miobridge/agent`)}`,
          `install -m 755 ${shellQuote(source.binaryPath)} ${shellQuote(runtime.binaryPath)}`,
          `install -m 600 -o ${shellQuote(runtimeUser)} ${shellQuote(source.configPath)} ${shellQuote(runtime.configPath)}`,
          'port=0', `for candidate in $(seq 49152 49252); do if [ "$candidate" != ${shellQuote(String(target.agentPort))} ] && [ -z "$(ss -ltnH \"sport = :$candidate\")" ]; then port=$candidate; break; fi; done`,
          '[ "$port" -ne 0 ] || { echo "候选端口冲突：没有可用临时端口" >&2; exit 1; }',
          `sed "s/^port:.*/port: $port/" ${shellQuote(runtime.configPath)} > ${shellQuote(`${runtime.configPath}.candidate`)}`,
          `chown ${shellQuote(runtimeUser)} ${shellQuote(`${runtime.configPath}.candidate`)}`, `chmod 600 ${shellQuote(`${runtime.configPath}.candidate`)}`,
          `printf %s ${encoded(systemAgentUnit(runtime, true))} | base64 -d > /run/systemd/system/miobridge-agent-candidate.service`,
          'systemctl daemon-reload', 'systemctl start miobridge-agent-candidate.service', 'printf %s "$port"',
        ].join('\n'));
        const port = Number(staged.stdout.trim());
        if (!Number.isInteger(port) || port < 49152 || port > 49252) throw new Error('候选服务未返回有效临时端口');
        const candidateHealth = await this.root(ssh, target, `for attempt in $(seq 1 20); do if curl --max-time 2 -fsS http://127.0.0.1:${port}/health; then exit 0; fi; sleep 0.25; done; exit 1`);
        let health: Record<string, unknown>;
        try { health = JSON.parse(candidateHealth.stdout) as Record<string, unknown>; } catch { throw new Error('候选服务健康响应无效'); }
        if (health.status !== 'healthy' || health.version !== version) throw new Error('候选系统服务的健康状态或版本验收失败');
        await this.root(ssh, target, `ss -ltnH 'sport = :${port}' | awk '$4 == "127.0.0.1:${port}" { found=1 } END { exit !found }' || { echo '候选 Agent 未绑定回环地址；请先升级 Agent 后重试迁移' >&2; exit 1; }`);
        await this.root(ssh, target, 'systemctl stop miobridge-agent-candidate.service');
        // Stop only after the candidate passed. Keep the old unit enabled until public acceptance passes.
        await this.run(ssh, target, userSystemctl('stop', 'miobridge-agent.service'));
        await this.root(ssh, target, [
          'set -eu', `[ -z "$(ss -ltnH 'sport = :${target.agentPort}')" ] || { echo 'Agent 端口冲突：原端口仍被其他进程占用' >&2; exit 1; }`,
          `printf %s ${encoded(systemAgentUnit(runtime))} | base64 -d > ${shellQuote(AGENT_SYSTEM_UNIT)}`,
          `printf %s ${encoded(JSON.stringify(runtime))} | base64 -d > ${shellQuote(AGENT_SERVICE_RECEIPT)}`,
          `chmod 644 ${shellQuote(AGENT_SYSTEM_UNIT)} ${shellQuote(AGENT_SERVICE_RECEIPT)}`,
          'systemctl daemon-reload', 'systemctl enable miobridge-agent.service', 'systemctl start miobridge-agent.service',
        ].join('\n'));
      });
    } catch (error) {
      let details = '';
      if (mutated) {
        try {
          details = await this.connected(node, async (ssh, target) => {
            const logs = await this.transport.execRoot(ssh, target, 'journalctl -u miobridge-agent-candidate.service -u miobridge-agent.service --no-pager -n 30');
            return clean(logs.stdout || logs.stderr, target).slice(-4000);
          });
        } catch (diagnosticError) { details = `日志读取失败：${clean(diagnosticError)}`; }
      }
      const message = `${clean(error)}${details ? `\n${details}` : ''}`;
      try { await rollback(); } catch (rollbackError) { throw new Error(`${message}；回滚失败：${clean(rollbackError)}`); }
      throw new Error(message);
    }
    return {
      rollback,
      commit: async () => {
        await this.connected(node, async (ssh, target) => {
          await this.run(ssh, target, userSystemctl('disable', 'miobridge-agent.service'));
          await this.root(ssh, target, `rm -f /run/systemd/system/miobridge-agent-candidate.service ${shellQuote(`${runtime!.configPath}.candidate`)} && systemctl daemon-reload`);
        });
        await this.composition.repository.update(node.id, current => ({ ...current, agent: { ...current.agent, deployed: true, version: previousVersion, status: 'running', lastDeploy: current.agent?.lastDeploy ?? '', serviceMode: 'system', runtimeUser: runtime!.user } }));
      },
    };
  }

  private async connected<T>(node: NodeConfig, action: (ssh: DeploymentConnection, target: SshTarget) => Promise<T>): Promise<T> {
    const target = await this.targets.forNode(node.id);
    const ssh = await this.transport.connect(target);
    try { return await action(ssh, target); }
    catch (error) { throw new Error(clean(error, target)); }
    finally { await ssh.end(); }
  }
  private async run(ssh: DeploymentConnection, target: SshTarget, command: string): Promise<ExecResult> {
    const result = await this.transport.exec(ssh, command);
    if (result.code !== 0) throw new Error(clean(result.stderr || result.stdout || 'Agent 操作失败，请检查服务和文件权限', target));
    return result;
  }
  private async root(ssh: DeploymentConnection, target: SshTarget, command: string): Promise<ExecResult> {
    const result = await this.transport.execRoot(ssh, target, command);
    if (result.code !== 0) throw new Error(clean(result.stderr || result.stdout || '系统级操作失败，请检查 sudo 权限、已有服务及 curl、ss、runuser 工具', target));
    return result;
  }
}

export function createNodeMaintenanceService(composition: NodeCoreComposition, options: DeploymentServiceOptions = {}): NodeMaintenanceService {
  const port = new SshNodeMaintenance(composition, options);
  const transport = new SshTransport(options);
  const targets = new NodeTargets(composition);
  const acceptance = composition.core.createAgentAcceptance(composition.agent);
  return composition.core.createNodeMaintenance({ port, withLock: (nodeId, action) => withNodeMutation(nodeId, async () => {
    try { return await action(); }
    finally { targets.clearOneTimeCredential(nodeId); }
  }), accept: async (node, version) => {
    const target = await targets.forNode(node.id);
    return acceptance.verify(node, version, { disconnect() {}, diagnose: signal => diagnoseAgent(transport, target, signal), sensitiveValues: [target.secret, target.ssh.password ?? '', target.ssh.privateKey ?? ''] });
  } });
}
