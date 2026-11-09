#!/usr/bin/env node
import { AuthService, qrcode } from '@miobridge/core';
import { localized } from './locale.js';
import { CLI_VERSION, formatStatus, runCli } from './command.js';
import { createNodeCore } from './composition.js';
import { DependencySetupService } from './setup/service.js';
import { createNodeSetupAdapters } from './setup/nodeAdapters.js';
import { DashboardForegroundService, createNodeForegroundAdapters } from './dashboard/foreground.js';
import { DashboardSystemdService, createNodeSystemdAdapters } from './dashboard/systemd.js';
import { SelfMaintenanceService } from './self/service.js';
import { createNodeSelfMaintenanceAdapters } from './self/nodeAdapters.js';
import { LocalNodeConfigurationService } from './nodes/localConfiguration.js';
import { createNodeMaintenanceService } from './dashboard/server/ssh/maintenance.js';
import { access, chmod, readFile, writeFile } from 'node:fs/promises';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SshDeploymentService } from './dashboard/server/sshDeployment.js';
const execFileAsync = promisify(execFile);

const output = {
  stdout(message: string) { process.stdout.write(`${message}\n`); },
  stderr(message: string) { process.stderr.write(`${message}\n`); },
};

const composition = createNodeCore({ metadata: { version: CLI_VERSION } });
if (process.argv[2] === 'setup') await new AuthService(composition.core.state).ensure(!composition.core.yaml.configExists());
const dashboardConfig = composition.core.config.getFullConfig().app;
const dashboardOptions = {
  ...(process.env.MIOBRIDGE_DASHBOARD_HOST ? { host: process.env.MIOBRIDGE_DASHBOARD_HOST } : {}),
  ...(process.env.MIOBRIDGE_DASHBOARD_PORT
    ? { port: Number(process.env.MIOBRIDGE_DASHBOARD_PORT) }
    : dashboardConfig?.port ? { port: dashboardConfig.port } : {}),
};
const setupAdapters = createNodeSetupAdapters();
const localNode = new LocalNodeConfigurationService(composition.repository, {
  ...setupAdapters,
  mihomoPath: composition.paths.managedPath('mihomo'),
  uninstallAgent: () => new SshDeploymentService(composition).agentAction('local', 'uninstall', { preserveConfig: true, preserveData: true }),
});
const nodeMaintenance = createNodeMaintenanceService(composition);
async function maintenanceNode(nodeId: string) {
  const nodes = await composition.repository.list({ enabledOnly: false });
  const exact = nodes.find(item => item.id === nodeId);
  const matches = exact ? [exact] : nodes.filter(item => item.name === nodeId || item.id.startsWith(nodeId));
  if (matches.length > 1) throw new Error('名称或 ID 前缀不唯一，请用 nodes list 查看完整 ID');
  const node = matches[0];
  if (!node) throw new Error(`节点 ${nodeId} 不存在`);
  return node;
}
const dashboardDaemon = new DashboardSystemdService(composition.paths, createNodeSystemdAdapters(), dashboardOptions);
const maintenance = new SelfMaintenanceService({
  async afterInstall(version) {
    const local = (await composition.repository.list({ enabledOnly: false })).find(node => node.id === 'local');
    const outdated = (await composition.repository.list()).filter(node => node.id !== 'local' && node.agent?.deployed && node.agent.version !== version);
    const notice = outdated.length ? `需升级 Agent 的子服务器：${outdated.map(node => node.name).join('、')}` : '';
    if (!local?.agent?.deployed) return notice;
    const result = await execFileAsync(process.execPath, ['nodes', 'upgrade-local'], { timeout: 1800000, env: process.env });
    return `${result.stdout}\n${notice}`;
  },
  currentVersion: CLI_VERSION,
  executablePath: process.execPath,
  dashboardPath: `${composition.paths.distDir}/dashboard`,
  configDir: composition.paths.baseDir,
  adapters: createNodeSelfMaintenanceAdapters(),
  progress: message => output.stdout(message),
  serviceControl: {
    async detect() {
      if ((await dashboardDaemon.status()).state === 'running') return 'systemd';
      // systemd 没接管但端口上有活的 dashboard，多半是前台进程还在跑旧版本。
      const port = Number(process.env.MIOBRIDGE_DASHBOARD_PORT) || dashboardConfig?.port || 3000;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2_000) });
        return response.ok ? 'external' : 'none';
      } catch {
        return 'none';
      }
    },
    refreshUnit: () => dashboardDaemon.refreshUnit(),
    restart: () => dashboardDaemon.restart(),
  },
  ...(process.env.MIOBRIDGE_REPOSITORY ? { repository: process.env.MIOBRIDGE_REPOSITORY } : {}),
  ...(process.env.MIOBRIDGE_VERSION ? { targetVersion: process.env.MIOBRIDGE_VERSION } : {}),
  ...(process.env.MIOBRIDGE_RELEASE_BASE_URL ? { releaseBaseUrl: process.env.MIOBRIDGE_RELEASE_BASE_URL } : {}),
});
const commandAbort = new AbortController();
const abortCommand = () => commandAbort.abort();
process.once('SIGINT', abortCommand);
process.once('SIGTERM', abortCommand);
const exitCode = await runCli(process.argv.slice(2), {
  async extraCommand(args) {
    const auth = new AuthService(composition.core.state);
    const base = composition.core.getEffectiveConfig().app?.public_base_url ?? `http://127.0.0.1:${dashboardOptions.port ?? 3000}`;
    if (args[0] === 'auth' && (args[1] === 'show' || args[1] === 'rotate') && args.slice(2).every(arg => arg === '--subscription')) {
      const config = args[1] === 'rotate' ? await auth.rotate(args.includes('--subscription')) : await auth.ensure();
      return `控制台: ${base}\n管理员令牌: ${config.admin_token}\n订阅: ${base}/clash.yaml?token=${config.subscription_token}`;
    }
    if (args.join(' ') === 'nodes upgrade-local') {
      const deployment = new SshDeploymentService(composition);
      const { taskId } = await deployment.startComponentDeployment('local', 'agent', 'upgrade');
      const deadline = Date.now() + 1800000;
      while (Date.now() < deadline) {
        const task = await deployment.getComponentDeployment(taskId);
        if (task?.status === 'success') return '本机 Agent 已升级并通过健康验收';
        if (task?.status === 'error' || task?.status === 'cancelled') throw new Error(task.message);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error('本机 Agent 升级超时，请检查任务日志');
    }
    if (args[0] === 'status' && args.slice(1).every(arg => arg === '--json')) {
      const [status, daemon, metrics] = await Promise.all([composition.core.getStatus(), dashboardDaemon.status(), composition.core.getMetricsSnapshot()]);
      const config = await auth.ensure();
      const subscriptionUrl = `${base}/clash.yaml${config.subscription_required ? `?token=${config.subscription_token}` : ''}`;
      if (args.includes('--json')) return JSON.stringify({ ...status, dashboard: daemon.state, onlineServers: metrics.onlineNodes, enabledServers: metrics.enabledNodes, lastGeneration: metrics.lastGeneration, subscriptionUrl });
      return [formatStatus(status), `${localized('Dashboard', '控制台')}: ${daemon.state} ${base}`, `${localized('Servers online', '服务器在线')}: ${metrics.onlineNodes}/${metrics.enabledNodes}`, `${localized('Last generation', '上次生成')}: ${metrics.lastGeneration?.status ?? '—'}`, `${localized('Subscription URL', '订阅地址')}: ${subscriptionUrl}`].join('\n');
    }
    if (args.join(' ') === 'doctor') {
      const checks: string[] = [];
      const daemon = await dashboardDaemon.status();
      checks.push(`${daemon.state === 'running' ? '✓' : '✗'} 控制台: ${daemon.state}；修复: miobridge dashboard start`);
      checks.push(`${daemon.linger ? '✓' : '✗'} Linger；修复: loginctl enable-linger ${process.env.USER ?? '当前用户'}`);
      checks.push(`${process.env.PATH?.split(':').includes(`${process.env.HOME}/.local/bin`) ? '✓' : '!'} PATH；检查 ~/.local/bin，或使用 CLI 完整路径`);
      for (const [label, path, fix] of [['mihomo', composition.paths.managedPath('mihomo'), 'miobridge setup --yes'], ['模板', composition.core.config.getTemplatePath(), '重新运行安装器，或配置 template.user.yaml'], ['本机 Agent', `${process.env.HOME}/.local/bin/miobridge-agent`, '控制台 → 服务器 → 本机 → 安装 Agent']] as const) {
        try { await access(path); checks.push(`✓ ${label}`); } catch { checks.push(`✗ ${label}；修复: ${fix}`); }
      }
      const [ports, firewall] = await Promise.all([
        execFileAsync('ss', ['-ltn']).then(result => result.stdout).catch(() => 'ss 不可用'),
        execFileAsync('sh', ['-c', 'if command -v ufw >/dev/null 2>&1; then ufw status; elif command -v firewall-cmd >/dev/null 2>&1; then firewall-cmd --list-ports; else echo "未检测到 ufw/firewalld"; fi']).then(result => result.stdout.trim()).catch(() => '无法读取防火墙规则，请以有权限的用户运行 ufw status 或 firewall-cmd --list-ports'),
      ]);
      checks.push(`监听端口:\n${ports}`, `防火墙: ${firewall}\n按需执行: ufw allow 3000/tcp；子服务器 ufw allow 3001/tcp（也需检查云安全组）`);
      if (dashboardConfig?.public_base_url) {
        try { const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) }); checks.push(`${response.ok ? '✓' : '✗'} 公网地址自检 HTTP ${response.status}`); }
        catch { checks.push('✗ 公网地址不可达，请检查 public_base_url、端口和防火墙'); }
      }
      return checks.join('\n');
    }
    if (args.join(' ') === 'dashboard url') return base;
    if (args.join(' ') === 'dashboard restart') { await dashboardDaemon.restart(); return `控制台已重启: ${base}`; }
    if (args[0] === 'nodes' && args[1] === 'list' && args.slice(2).every(arg => arg === '--json')) {
      const status = await composition.aggregation.getClusterStatus();
      const nodes = status.nodes.map(node => ({ id: node.nodeId, name: node.name, host: node.host, online: node.online, version: node.version ?? node.agent?.version ?? '' }));
      return args.includes('--json') ? JSON.stringify(nodes) : nodes.map(node => `${node.id}\t${node.name}\t${node.host}\t${node.online ? '在线' : '离线'}\t${node.version}`).join('\n') || '尚未添加服务器';
    }
    if (args[0] === 'subscription' && args[1] === 'url' && args.slice(2).every(arg => arg === '--qr')) {
      const config = await auth.ensure(); const url = `${base}/clash.yaml${config.subscription_required ? `?token=${config.subscription_token}` : ''}`;
      if (!args.includes('--qr')) return url;
      const code = qrcode(0, 'M'); code.addData(url); code.make();
      let rendered = '';
      for (let row = -2; row < code.getModuleCount() + 2; row++) {
        for (let col = -2; col < code.getModuleCount() + 2; col++) rendered += row >= 0 && col >= 0 && row < code.getModuleCount() && col < code.getModuleCount() && code.isDark(row, col) ? '██' : '  ';
        rendered += '\n';
      }
      return `${url}\n${rendered}`;
    }
    return undefined;
  },
  createCore: () => composition.core,
  setup: new DependencySetupService({ paths: composition.paths, adapters: setupAdapters, configured: {
    ...composition.configuredBinaries,
    ...(process.env.MIOBRIDGE_MIHOMO_PATH ? { mihomo: process.env.MIOBRIDGE_MIHOMO_PATH } : {}),
    ...(process.env.MIOBRIDGE_SING_BOX_PATH ? { 'sing-box': process.env.MIOBRIDGE_SING_BOX_PATH } : {}),
  } }),
  localNode,
  nodeMaintenance: {
    diagnose: async nodeId => nodeMaintenance.diagnose(await maintenanceNode(nodeId)),
    repair: async nodeId => nodeMaintenance.repair(await maintenanceNode(nodeId)),
    migrate: async (nodeId, runtimeUser) => nodeMaintenance.migrate(await maintenanceNode(nodeId), runtimeUser),
  },
  maintenance: {
    upgrade: () => maintenance.upgrade(),
    async uninstall(purge) {
      const local = (await composition.repository.list({ enabledOnly: false })).find(node => node.id === 'local');
      const installed = await Promise.any([access(`${process.env.HOME}/.local/bin/miobridge-agent`), access('/etc/systemd/system/miobridge-agent.service')]).then(() => true, () => false);
      if (local?.agent?.deployed || installed) {
        if (!local) await composition.repository.configureLocalNode(true);
        await new SshDeploymentService(composition).agentAction('local', 'uninstall', { preserveConfig: !purge, preserveData: !purge });
      }
      await dashboardDaemon.uninstall();
      return maintenance.uninstall({ purge });
    },
  },
  dashboard: {
    foreground: () => new DashboardForegroundService(composition.paths, createNodeForegroundAdapters(composition)).run(dashboardOptions),
    daemon: async action => { const status = await dashboardDaemon[action](); return { ...status, message: `${status.message}\n控制台: ${dashboardConfig?.public_base_url ?? `http://127.0.0.1:${dashboardOptions.port ?? 3000}`}\n登录令牌: miobridge auth show` }; },
  },
  output,
  readTextFile: path => readFile(path, 'utf8'),
  async writeTextFile(path, content) {
    await writeFile(path, content, { encoding: 'utf8', mode: 0o600 });
    await chmod(path, 0o600);
  },
  signal: commandAbort.signal,
  version: CLI_VERSION,
});
process.removeListener('SIGINT', abortCommand);
process.removeListener('SIGTERM', abortCommand);
process.exitCode = exitCode;
