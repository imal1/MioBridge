import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeCore } from '../../src/index.js';
import { createNodeDashboardDependencies } from '../../src/dashboard/server/nodeDependencies.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

// 233boy 管理脚本的导出：公网 IP + 固定跳过校验。
const TROJAN = 'trojan://secret@203.0.113.7:8443?type=tcp&security=tls&allowInsecure=1&insecure=1#233boy-trojan-203.0.113.7';
const HYSTERIA2 = 'hysteria2://secret@203.0.113.7:8444?alpn=h3&insecure=1#233boy-hysteria2-203.0.113.7';

function compose(baseDir: string) {
  const composition = createNodeCore({
    platformBaseDir: baseDir,
    env: { PATH: '' },
    local: { isAvailable: async () => true, extractNodeUrls: async () => [TROJAN, HYSTERIA2] },
    remote: { collectRemoteNodeSources: async () => ({ sources: [], errors: [] }) },
    mihomo: {
      checkHealth: async () => true,
      getVersion: async () => ({ version: 'test' }),
      convertToClashByContent: async content => `proxies:\n${content}\n`,
    },
  });
  return { composition, operations: createNodeDashboardDependencies(composition).operations };
}

describe('node subscription endpoint settings (issue #48)', () => {
  it('persists domain, SNI, verification policy and display name across updates and restarts without touching the Agent address', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'miobridge-node-proxy-'));
    roots.push(baseDir);
    const first = compose(baseDir);
    await first.composition.repository.configureLocalNode(true);
    const raw = async () => readFile(join(first.composition.core.config.getConfig().staticDir, 'raw.txt'), 'utf8');

    await first.composition.core.updateSubscription();
    expect(await raw()).toBe(`${TROJAN}\n${HYSTERIA2}`);

    const saved = await first.operations.updateNode('local', {
      proxy: { server: 'ht.example.com', sni: 'ht.example.com', certVerify: 'strict', displayName: 'HT' },
    });
    expect(saved.data).toMatchObject({
      id: 'local', host: '127.0.0.1',
      proxy: { server: 'ht.example.com', sni: 'ht.example.com', certVerify: 'strict', displayName: 'HT' },
    });

    const expected = [
      'trojan://secret@ht.example.com:8443?type=tcp&security=tls&sni=ht.example.com#HT%20Trojan',
      'hysteria2://secret@ht.example.com:8444?alpn=h3&sni=ht.example.com#HT%20Hysteria2',
    ].join('\n');
    await first.composition.core.updateSubscription();
    expect(await raw()).toBe(expected);
    // 再次更新订阅不得恢复 IP 与 insecure。
    await first.composition.core.updateSubscription();
    expect(await raw()).toBe(expected);

    // 新的 composition = dashboard 重启后的进程。
    const restarted = compose(baseDir);
    await restarted.composition.core.updateSubscription();
    expect(await raw()).toBe(expected);
    const clash = await readFile(join(restarted.composition.core.config.getConfig().staticDir, 'clash.yaml'), 'utf8');
    expect(decodeURIComponent(clash)).toContain('#HT Trojan');
    const status = await restarted.operations.getClusterStatus();
    expect((status.data as { nodes: unknown[] }).nodes[0]).toMatchObject({ host: '127.0.0.1', proxy: { server: 'ht.example.com', displayName: 'HT' } });

    // 无关的档案编辑保留出口设置；重命名显示名称后产物随之更新。
    await restarted.operations.updateNode('local', { name: '主控机' });
    expect((await restarted.composition.repository.list())[0]).toMatchObject({ name: '主控机', proxy: { certVerify: 'strict' } });
    await restarted.operations.updateNode('local', { proxy: { server: 'ht.example.com', certVerify: 'insecure', displayName: 'HT-2', protocols: ['hy2'] } });
    await restarted.composition.core.updateSubscription();
    expect(await raw()).toBe([
      'trojan://secret@203.0.113.7:8443?type=tcp&security=tls&allowInsecure=1&insecure=1#HT-2%20Trojan',
      'hysteria2://secret@ht.example.com:8444?alpn=h3&insecure=1#HT-2%20Hysteria2',
    ].join('\n'));

    await expect(restarted.operations.updateNode('local', { proxy: { server: 'bad host' } })).rejects.toThrow('连接域名');
    await expect(restarted.operations.updateNode('local', { proxy: { certVerify: 'auto' } })).rejects.toThrow('证书校验策略');

    const cleared = await restarted.operations.updateNode('local', { proxy: null });
    expect(cleared.data).not.toHaveProperty('proxy');
    await restarted.composition.core.updateSubscription();
    expect(await raw()).toBe(`${TROJAN}\n${HYSTERIA2}`);
  });
});
