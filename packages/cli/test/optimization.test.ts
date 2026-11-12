import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { AuthService } from '@miobridge/core';
import { createNodeCore } from '../src/composition.js';
import { createDashboardApp } from '../src/dashboard/server/nodeServer.js';
import { createNodeDashboardDependencies } from '../src/dashboard/server/nodeDependencies.js';
import { SubscriptionJobService } from '../src/operations/subscriptionJobs.js';
import { recordMetric, metricHistory } from '../src/operations/metricHistory.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'miobridge-optimization-cli-')); roots.push(root);
  const composition = createNodeCore({ env: { MIOBRIDGE_CONFIG_DIR: root }, local: { isAvailable: async () => false, extractNodeUrls: async () => [] }, remote: { collectRemoteNodeSources: async () => ({ sources: [], errors: [] }) } });
  return { root, composition };
}
it('enforces API login, strict cookies, CSRF protection and subscription-token isolation', async () => {
  const { root, composition } = await fixture(); const auth = new AuthService(composition.core.state); const config = await auth.ensure(true);
  const app = createDashboardApp({ auth, root, fallbackToIndex: false, reservedPaths: ['/api'], logger: false, dependencies: createNodeDashboardDependencies(composition) });
  try {
    expect((await app.inject('/api/status')).statusCode).toBe(401);
    expect((await app.inject('/api/deployments/agent/manual-config?nodeId=local')).statusCode).toBe(401);
    expect((await app.inject('/clash.yaml')).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { token: config.admin_token } });
    expect(login.statusCode).toBe(200);
    const setCookie = String(login.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly'); expect(setCookie).toContain('SameSite=Strict');
    const cookie = setCookie.split(';')[0]!;
    expect((await app.inject({ url: '/api/auth/session', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/subscription', headers: { cookie, origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/clash.yaml?token=' + config.subscription_token })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/status', headers: { authorization: 'Bearer ' + config.subscription_token } })).statusCode).toBe(401);
    const missing = await app.inject({ url: '/clash.yaml?token=' + config.subscription_token });
    expect(missing.body).toBe('Not Found'); expect(missing.body).not.toContain(root);
    await auth.rotate(); expect((await app.inject({ url: '/api/auth/session', headers: { cookie } })).statusCode).toBe(401);
  } finally { await app.close(); }
});
it('migrates legacy subscription policy once and reads subsequent config edits immediately', async () => {
  const { composition } = await fixture();
  await composition.core.state.set('subscription-policy.json', JSON.stringify({ enabled: false, cron: '0 9-18 * * 1-5', freshnessHours: 10 }));
  const service = new SubscriptionJobService(composition);
  expect((await service.policy()).freshnessHours).toBe(10);
  expect(await composition.core.state.get('subscription-policy.json')).toBeNull();
  expect(await composition.core.state.get('subscription-policy.json.migrated')).not.toBeNull();
  await composition.core.setConfigValue('subscription.freshness_hours', 12);
  expect((await service.policy()).freshnessHours).toBe(12);
  await service.updatePolicy({ enabled: false, cron: '0 0 * * 7', retryDelaysMinutes: [] });
  expect(composition.core.getEffectiveConfig().subscription?.cron).toBe('0 0 * * 7');
  service.close();
});
it('records daily metric history and read requests do not append samples', async () => {
  const { composition } = await fixture();
  const snapshot = await composition.core.getMetricsSnapshot();
  await recordMetric(composition.core.state, snapshot);
  const before = await composition.core.state.get(`metrics/${snapshot.timestamp.slice(0, 10)}.jsonl`);
  expect(await metricHistory(composition.core.state, 0)).toHaveLength(1);
  expect(await composition.core.state.get(`metrics/${snapshot.timestamp.slice(0, 10)}.jsonl`)).toBe(before);
});

it('retains root bootstrap credentials for retry, then uses the verified dedicated key across restarts', async () => {
  const { composition, root } = await fixture();
  const { SshDeploymentService } = await import('../src/dashboard/server/sshDeployment.js');
  const { NodeTargets } = await import('../src/dashboard/server/ssh/targets.js');
  await composition.repository.add({ id: 'remote', name: 'Remote', host: 'remote.example', location: '', secret: '', kernels: [], enabled: true, ssh: { user: 'root', port: 22, authMethod: 'password', hostKey: 'fingerprint' } });
  let fail = true; const methods: string[] = [];
  const service = new SshDeploymentService(composition, { connect: async target => {
    methods.push(target.ssh.authMethod);
    if (target.ssh.authMethod === 'password') expect(target.ssh.password).toBe('bootstrap-secret');
    return { run: async () => ({ code: fail ? 1 : 0, stdout: '', stderr: '' }), end() {} };
  } });
  service.setOneTimeCredential('remote', 'bootstrap-secret');
  await expect(service.enrollControllerKey('remote')).rejects.toThrow('无法安装');
  fail = false;
  await service.enrollControllerKey('remote');
  expect(methods).toEqual(['password', 'password', 'privateKey']);
  const fresh = new NodeTargets(createNodeCore({ env: { MIOBRIDGE_CONFIG_DIR: root } }));
  const target = await fresh.forNode('remote');
  expect(target.ssh.authMethod).toBe('privateKey');
  expect(target.ssh.privateKey).toContain('BEGIN OPENSSH PRIVATE KEY');
  expect(target.ssh.password).toBeUndefined();
  expect(await composition.core.state.get('nodes.yaml')).not.toContain('bootstrap-secret');
  const { stat } = await import('node:fs/promises');
  expect((await stat(join(root, 'ssh/id_ed25519'))).mode & 0o777).toBe(0o600);
});

it('selects CLI language from locale precedence and documents new maintenance commands', async () => {
  const { cliLanguage } = await import('../src/locale.js');
  const { helpText, chineseHelpText } = await import('../src/command.js');
  expect(cliLanguage({ LANG: 'zh_CN.UTF-8' })).toBe('zh');
  expect(cliLanguage({ LANG: 'zh_CN.UTF-8', LC_ALL: 'C' })).toBe('en');
  for (const command of ['auth rotate', 'subscription url', 'nodes list', 'nodes proxy', 'doctor']) {
    expect(helpText).toContain(command); expect(chineseHelpText).toContain(command);
  }
});

it('writes searchable control logs with severity, credential redaction and retention', async () => {
  const { root } = await fixture();
  const { createFileLogger } = await import('../src/logs/fileLogger.js');
  const { writeFile, readdir } = await import('node:fs/promises');
  await writeFile(join(root, 'miobridge-2000-01-01.log'), 'old');
  const settings = { level: 'warn', retentionDays: 14 };
  const logger = createFileLogger(root, () => settings);
  logger.info('filtered');
  logger.warn('offline trojan://secret@host#name', { password: 'password', url: 'https://host?token=subscription-secret' });
  settings.level = 'debug'; logger.debug('runtime level changed');
  const files = (await readdir(root)).filter(name => name.endsWith('.log'));
  expect(files).toHaveLength(1);
  const content = await readFile(join(root, files[0]!), 'utf8');
  expect(content).not.toContain('filtered'); expect(content).not.toContain('subscription-secret'); expect(content).not.toContain('trojan://secret');
  expect(content).toContain('runtime level changed'); expect(content).toContain('"level":"warn"');
});

it('expires metric days after 30 days and downsamples old days to hourly samples', async () => {
  const { composition } = await fixture();
  const sample = await composition.core.getMetricsSnapshot(); const state = composition.core.state;
  await state.set('metrics/2026-01-01.jsonl', JSON.stringify({ ...sample, timestamp: '2026-01-01T00:00:00Z' }));
  await state.set('metrics/2026-01-20.jsonl', ['00:00', '00:05', '01:00'].map(time => JSON.stringify({ ...sample, timestamp: `2026-01-20T${time}:00Z` })).join('\n'));
  await recordMetric(state, { ...sample, timestamp: '2026-02-08T00:00:00Z' });
  expect(await state.get('metrics/2026-01-01.jsonl')).toBeNull();
  expect((await state.get('metrics/2026-01-20.jsonl'))?.trim().split('\n')).toHaveLength(2);
});
