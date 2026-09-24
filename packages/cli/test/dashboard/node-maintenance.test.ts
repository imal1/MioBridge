import { describe, expect, it, vi } from 'vitest';
import { AgentDeploymentAcceptance, NodeMaintenanceService, type AgentClient, type AgentDeploymentAcceptanceOptions, type NodeConfig, type NodeMaintenanceServiceOptions } from '@miobridge/core';
import type { NodeCoreComposition } from '../../src/composition.js';
import { createNodeMaintenanceService, SshNodeMaintenance } from '../../src/dashboard/server/ssh/maintenance.js';
import { SshTransport } from '../../src/dashboard/server/ssh/transport.js';
import { installAgent, startAgent, agentServiceAction } from '../../src/dashboard/server/ssh/agent.js';
import { systemAgentRuntime } from '../../src/dashboard/server/ssh/agentRuntime.js';
import { SshDeploymentService } from '../../src/dashboard/server/sshDeployment.js';
import { CLI_VERSION } from '../../src/command.js';
import { NodeTargets } from '../../src/dashboard/server/ssh/targets.js';
import type { DeploymentConnection, ExecResult, SshTarget } from '../../src/dashboard/server/ssh/types.js';

function fixture(options: { linger?: boolean; running?: boolean; enabled?: boolean; config?: boolean; privilege?: boolean; conflict?: boolean; candidateVersion?: string; health?: boolean; failRepair?: boolean; sshError?: boolean; existingSystem?: boolean; failSystemStop?: boolean; restoredExits?: boolean } = {}) {
  const runtime = { ...systemAgentRuntime('agent', '/home/agent'), sourceUser: 'alice', sourceHome: '/home/alice' };
  let node: NodeConfig = { id: 'local', name: 'Local', host: '127.0.0.1', secret: 'agent-secret', location: '', enabled: true, kernels: [], agent: { deployed: true, status: 'running', version: '1.2.12', lastDeploy: '' } };
  const events: string[] = [];
  const commands: string[] = [];
  let live = 0;
  let system = false;
  let oldEnabled = options.enabled ?? true;
  let oldActive = options.running ?? true;
  let linger = options.linger ?? true;
  let config = options.config ?? true;
  const ok = (stdout = ''): ExecResult => ({ stdout, stderr: '', code: 0 });
  const fail = (stderr: string): ExecResult => ({ stdout: '', stderr, code: 1 });
  async function run(command: string): Promise<ExecResult> {
    commands.push(command);
    if (command === 'id -u') return options.privilege === false ? fail('sudo requires permission') : ok('0');
    if (command === 'id -un') return ok('alice');
    if (command === 'printf %s "$HOME"') return ok('/home/alice');
    if (command.startsWith('getent passwd')) return ok('agent:x:1002:1002::/home/agent:/bin/bash');
    if (command.startsWith('uname -m')) return ok('x86_64');
    if (command.startsWith('test ! -e')) return options.existingSystem ? fail('existing system unit') : ok();
    if (command.startsWith('test -f') && command.includes('miobridge-service.json')) return system ? ok() : fail('');
    if ((command.startsWith('if test -f') || command.startsWith('cat ')) && command.includes('miobridge-service.json')) return ok(system ? JSON.stringify(runtime) : '');
    if (command.includes('loginctl show-user')) return ok(linger ? 'yes' : 'no');
    if (command.includes('loginctl enable-linger')) { if (options.failRepair) return fail('denied agent-secret'); linger = true; return ok(); }
    if (command.includes("'show'")) return ok(`UnitFileState=${system || oldEnabled ? 'enabled' : 'disabled'}\nActiveState=${system || oldActive ? 'active' : 'inactive'}\nNRestarts=0\nLoadState=loaded`);
    if (command.includes('--version') && !command.includes('download')) return ok('1.2.12');
    if (command.includes('cmp -s')) return config ? ok() : fail('config drift');
    if (command.includes('.agent.yaml.tmp.XXXXXX')) { config = true; events.push('config-repaired'); return ok(); }
    if (command.includes('port=0')) { events.push('candidate-start'); return ok('49152'); }
    if (command.startsWith('for attempt')) { const restored = command.includes(':3001/health'); events.push(restored ? 'restored-health' : 'candidate-health'); return ok(JSON.stringify({ status: 'healthy', version: restored ? '1.2.12' : options.candidateVersion ?? '1.2.12' })); }
    if (command.includes('未绑定回环地址')) return ok();
    if (command.startsWith('systemctl stop miobridge-agent-candidate')) { events.push('candidate-stop'); return ok(); }
    if (command.includes('原端口仍被其他进程占用')) {
      if (options.conflict) return fail('Agent 端口冲突');
      events.push('system-start'); system = true; return ok();
    }
    if (command.includes('系统级 Agent 未停止')) { events.push('rollback-system'); if (options.failSystemStop) return fail('system service could not stop'); system = false; return ok(); }
    if (command.includes("'systemctl' '--user'")) {
      if (command.includes("'is-active'") && options.restoredExits && events.includes('rollback-system')) return fail('restored service exited');
      if (command.includes("'disable'")) { oldEnabled = false; events.push('old-disabled'); }
      if (command.includes("'enable'")) { oldEnabled = true; events.push('old-enabled'); }
      if (command.includes("'stop'")) { oldActive = false; events.push('old-stopped'); }
      if (command.includes("'start'") || command.includes("'restart'")) { oldActive = true; events.push('old-started'); }
      return ok();
    }
    if (command.includes('download')) { events.push(system ? 'system-upgrade' : 'user-upgrade'); return ok(); }
    return ok();
  }
  class Transport extends SshTransport {
    override async connect(): Promise<DeploymentConnection> {
      if (options.sshError) throw new Error('SSH connect refused agent-secret');
      live += 1;
      return { run, end: async () => { live -= 1; events.push('disconnected'); } };
    }
    override async execRoot(ssh: DeploymentConnection, _target: SshTarget, command: string) { return ssh.run(command); }
  }
  const transport = new Transport();
  const composition = {
    repository: { list: async () => [node], update: async (_id: string, update: (n: NodeConfig) => NodeConfig) => { node = update(node); return node; } },
    core: {
      state: { get: async () => null },
      createNodeMaintenance: (options: NodeMaintenanceServiceOptions) => new NodeMaintenanceService(options),
      createAgentAcceptance: (client: AgentClient, options: AgentDeploymentAcceptanceOptions = {}) => new AgentDeploymentAcceptance(client, { wait: async () => {}, ...options }),
    },
    agent: { get: async () => {
      if (options.health === false) throw new Error('public health unreachable');
      return { status: 'healthy', version: '1.2.12' };
    } },
  } as unknown as NodeCoreComposition;
  const port = new SshNodeMaintenance(composition, {}, transport);
  const accept = vi.fn(async () => { expect(live).toBe(0); events.push('accepted'); });
  const service = new NodeMaintenanceService({ port, accept });
  return { service, port, accept, transport, events, commands, runtime, composition, run, get node() { return node; }, get oldEnabled() { return oldEnabled; }, get oldActive() { return oldActive; }, get system() { return system; } };
}

describe('node SSH maintenance adapter', () => {
  it('reports all required healthy checks without mutating the host', async () => {
    const f = fixture();
    const report = await f.service.diagnose(f.node);
    expect(report.healthy).toBe(true);
    expect(report.checks.map(c => c.key)).toEqual(['ssh', 'linger', 'unit', 'enabled', 'running', 'restarts', 'version', 'config', 'health']);
    expect(f.events).toEqual(['disconnected']);
  });
  it('keeps SSH failures separate from public Agent health and redacts secrets', async () => {
    const f = fixture({ sshError: true });
    const report = await f.service.diagnose(f.node);
    expect(report.checks.find(c => c.key === 'ssh')).toMatchObject({ status: 'fail', reason: 'SSH connect refused [redacted]' });
    expect(report.checks.find(c => c.key === 'health')?.status).toBe('pass');
    expect(JSON.stringify(report)).not.toContain('agent-secret');
  });
  it('repairs only discovered defects and accepts after disconnect', async () => {
    const f = fixture({ linger: false, running: false, enabled: false });
    expect((await f.service.repair(f.node)).healthy).toBe(true);
    expect(f.oldActive).toBe(true);
    expect(f.oldEnabled).toBe(true);
    expect(f.commands.some(c => c.includes('download'))).toBe(false);
    expect(f.commands.some(c => c.includes('.agent.yaml.tmp.XXXXXX'))).toBe(false);
    expect(f.events).toContain('accepted');
  });
  it('surfaces failed repair without falsely reporting acceptance', async () => {
    const f = fixture({ linger: false, failRepair: true });
    await expect(f.service.repair(f.node)).rejects.toThrow('denied [redacted]');
    expect(f.accept).not.toHaveBeenCalled();
  });
  it('restores configuration drift through validated replacement', async () => {
    const f = fixture({ config: false });
    expect((await f.service.repair(f.node)).healthy).toBe(true);
    expect(f.events).toContain('config-repaired');
  });
  it('validates the candidate before handover and disables the old unit only after public acceptance', async () => {
    const f = fixture();
    f.accept.mockImplementation(async () => { expect(f.oldEnabled).toBe(true); expect(f.oldActive).toBe(false); f.events.push('accepted'); });
    expect((await f.service.migrate(f.node, 'agent')).serviceMode).toBe('system');
    expect(f.events.indexOf('candidate-health')).toBeLessThan(f.events.indexOf('old-stopped'));
    expect(f.events.indexOf('accepted')).toBeLessThan(f.events.indexOf('old-disabled'));
    expect(f.node.agent).toMatchObject({ serviceMode: 'system', runtimeUser: 'agent' });
    expect(f.commands.join('\n')).toContain('/home/agent/.config/miobridge/agent/agent.yaml');
  });
  it.each([{ privilege: false }, { existingSystem: true }])('does not touch existing services when preflight fails (%j)', async options => {
    const f = fixture(options);
    await expect(f.service.migrate(f.node, 'agent')).rejects.toThrow();
    expect(f.events).not.toContain('candidate-start');
    expect(f.events).not.toContain('old-stopped');
    expect(f.events).not.toContain('rollback-system');
  });
  it.each([{ conflict: true }, { candidateVersion: '0.1.0' }])('restores prior service after staged migration failure (%j)', async options => {
    const f = fixture(options);
    await expect(f.service.migrate(f.node, 'agent')).rejects.toThrow();
    expect(f.system).toBe(false);
    expect(f.oldActive).toBe(true);
    expect(f.oldEnabled).toBe(true);
    expect(f.accept).not.toHaveBeenCalled();
  });
  it('rolls back a failed independent acceptance and preserves a previously disabled unit', async () => {
    const f = fixture({ enabled: false });
    f.accept.mockRejectedValueOnce(new Error('Agent lost after disconnect'));
    await expect(f.service.migrate(f.node, 'agent')).rejects.toThrow('Agent lost after disconnect；已恢复');
    expect(f.system).toBe(false);
    expect(f.oldActive).toBe(true);
    expect(f.oldEnabled).toBe(false);
  });
  it('preserves new service evidence and refuses to claim rollback if the system service cannot stop', async () => {
    const f = fixture({ failSystemStop: true });
    f.accept.mockRejectedValueOnce(new Error('public acceptance failed'));
    await expect(f.service.migrate(f.node, 'agent')).rejects.toThrow('public acceptance failed；回滚失败：system service could not stop');
    expect(f.system).toBe(true);
    expect(f.oldActive).toBe(false);
  });
  it('does not claim restored when the old user service immediately exits', async () => {
    const f = fixture({ restoredExits: true });
    f.accept.mockRejectedValueOnce(new Error('public acceptance failed'));
    await expect(f.service.migrate(f.node, 'agent')).rejects.toThrow('public acceptance failed；回滚失败：restored service exited');
  });
  it('checks the restored user service independently after rollback disconnect', async () => {
    const f = fixture();
    f.accept.mockRejectedValueOnce(new Error('public acceptance failed')).mockRejectedValueOnce(new Error('restored user failed after logout'));
    await expect(f.service.migrate(f.node, 'agent')).rejects.toThrow('public acceptance failed；回滚失败：restored user failed after logout');
    expect(f.accept).toHaveBeenCalledTimes(2);
  });
  it('upgrades and restarts the system service after migration without re-enabling the user service', async () => {
    const f = fixture();
    await f.service.migrate(f.node, 'agent');
    f.events.length = 0;
    f.commands.length = 0;
    const target: SshTarget = { local: true, nodeId: 'local', nodeName: 'Local', secret: 'agent-secret', agentPort: 3001, kernels: [], ssh: { host: '127.0.0.1', user: 'alice', port: 0, authMethod: 'password', hostKey: '' } };
    const ssh = await f.transport.connect(target);
    await installAgent(f.transport, ssh, target, []);
    await startAgent(f.transport, ssh, target);
    expect(await agentServiceAction(f.transport, ssh, target, 'restart', { preserveConfig: false, preserveData: false })).toBe(true);
    await ssh.end();
    expect(f.events).toContain('system-upgrade');
    expect(f.oldEnabled).toBe(false);
    expect(f.commands.find(c => c.includes('install -m 755 "$workdir/agent"'))).toContain('/home/agent/.config/miobridge/bin/miobridge-agent');
    expect(f.commands.some(c => c.includes('systemctl daemon-reload && systemctl enable miobridge-agent.service'))).toBe(true);
    expect(f.events).not.toContain('old-enabled');
  });
  it.each([true, false])('preserves the migrated runtime metadata through deployment completion (accepted=%s)', async accepted => {
    const f = fixture();
    await f.service.migrate(f.node, 'agent');
    const deployment = new SshDeploymentService(f.composition, {
      runLocal: f.run,
      fetch: (async () => Response.json({ status: 'healthy', version: accepted ? CLI_VERSION : '0.1.0' })) as typeof fetch,
      acceptance: { wait: async () => {} },
    });
    await deployment.startDeployment('local');
    expect(f.node.agent).toMatchObject({ serviceMode: 'system', runtimeUser: 'agent', status: 'deploying' });
    await vi.waitFor(() => expect(deployment.getProgress('local')?.status).toBe(accepted ? 'success' : 'error'));
    expect(f.node.agent).toMatchObject({ serviceMode: 'system', runtimeUser: 'agent' });
    await deployment.agentAction('local', 'stop');
    expect(f.node.agent).toMatchObject({ serviceMode: 'system', runtimeUser: 'agent', status: 'stopped' });
  });
  it('uninstalls the system runtime and old disabled user unit while honoring configuration preservation', async () => {
    const f = fixture();
    await f.service.migrate(f.node, 'agent');
    f.commands.length = 0;
    const deployment = new SshDeploymentService(f.composition, { runLocal: f.run });
    await deployment.agentAction('local', 'uninstall', { preserveConfig: true, preserveData: true });
    const removal = f.commands.find(command => command.includes('systemctl disable --now miobridge-agent.service')) ?? '';
    expect(removal).toContain('/home/agent/.config/miobridge/bin/miobridge-agent');
    expect(removal).toContain('/home/alice/.local/bin/miobridge-agent');
    expect(removal).toContain('/home/alice/.config/systemd/user/miobridge-agent.service');
    expect(removal).not.toContain('/home/alice/.config/miobridge-agent');
    expect(removal).not.toContain('/home/agent/.config/miobridge/agent/agent.yaml');
    expect(f.node.agent?.serviceMode).toBeUndefined();
    expect(f.node.agent?.runtimeUser).toBeUndefined();
    expect(f.node.agent?.deployed).toBe(false);
  });
  it.each([true, false])('shares one-time root credentials across factories, retains them for diagnosis, and clears after mutation (success=%s)', async succeeds => {
    const f = fixture({ linger: succeeds, failRepair: !succeeds });
    f.node.id = 'remote';
    f.node.ssh = { user: 'root', port: 22, authMethod: 'password', hostKey: '' };
    const connected: SshTarget[] = [];
    const spy = vi.spyOn(SshTransport.prototype, 'connect').mockImplementation(async target => {
      connected.push(target);
      return { run: f.run, end() {} };
    });
    try {
      const deployment = new SshDeploymentService(f.composition);
      const maintenance = createNodeMaintenanceService(f.composition);
      deployment.setOneTimeCredential('remote', 'root-password-once');
      await maintenance.diagnose(f.node);
      expect((await new NodeTargets(f.composition).forNode('remote')).ssh.password).toBe('root-password-once');
      const separate = { ...f.composition };
      await expect(new NodeTargets(separate).forNode('remote')).rejects.toThrow('凭据不存在');
      if (succeeds) expect((await maintenance.repair(f.node)).healthy).toBe(true);
      else await expect(maintenance.repair(f.node)).rejects.toThrow('denied [redacted]');
      expect(connected.length).toBeGreaterThanOrEqual(2);
      expect(connected.every(target => target.ssh.password === 'root-password-once')).toBe(true);
      await expect(new NodeTargets(f.composition).forNode('remote')).rejects.toThrow('凭据不存在');
    } finally { spy.mockRestore(); }
  });
});
