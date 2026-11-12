import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import {
  ArtifactService, MihomoAdapter, NodeAggregationService, NodeRepository, AgentClient,
  applyNodeDisplayNames, applyNodeProxy, createRuntimePaths, validateNodeProxy,
  type CollectedProxySource, type KernelFileSystem, type NodeProxyConfig, type StateStore,
} from '../../src/index.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

// 233boy 管理脚本按公网 IP 导出并固定带上跳过校验参数——issue #48 的原始输入。
const TROJAN = 'trojan://p%40ss@203.0.113.7:8443?type=tcp&security=tls&allowInsecure=1&insecure=1#233boy-trojan-203.0.113.7';
const HYSTERIA2 = 'hysteria2://secret@203.0.113.7:8444?alpn=h3&insecure=1#233boy-hysteria2-203.0.113.7';
const strict: NodeProxyConfig = { server: 'ht.example.com', sni: 'ht.example.com', certVerify: 'strict' };

function memoryStore(initial: string | null): StateStore {
  let value = initial;
  return { kind: 'file', get: async () => value, set: async (_key, next) => { value = next; }, del: async () => { value = null; }, withLock: async (_key, fn) => fn() };
}

class MemoryFs implements KernelFileSystem {
  readonly files = new Map<string, string>();
  async exists(path: string) { return this.files.has(path); }
  async mkdir() {}
  async readFile(path: string) { return this.files.get(path) ?? ''; }
  async writeFile(path: string, content: string) { this.files.set(path, content); }
  async remove(path: string) { this.files.delete(path); }
}

function mihomo(): MihomoAdapter {
  const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: '/state', PATH: '' }, applicationRoot: '/app' });
  const fs = new MemoryFs();
  fs.files.set(paths.templateFile, readFileSync(resolve(import.meta.dirname, '../../resources/template.yaml'), 'utf8'));
  return new MihomoAdapter({
    paths, fs, logger, runtimeDir: '/runtime',
    process: { run: async () => ({ stdout: 'Mihomo v1.19.3', stderr: '' }), which: async () => null },
  });
}

describe('validateNodeProxy', () => {
  it('normalizes input, drops empty values and keeps nodes.yaml free of empty blocks', () => {
    expect(validateNodeProxy(undefined)).toBeUndefined();
    expect(validateNodeProxy({ server: ' ', sni: '', displayName: '  ', protocols: [] })).toBeUndefined();
    expect(validateNodeProxy({ server: ' ht.example.com ', sni: 'ht.example.com', certVerify: 'strict', protocols: ['hy2', 'trojan', 'trojan'], displayName: ' HT ' }))
      .toEqual({ server: 'ht.example.com', sni: 'ht.example.com', certVerify: 'strict', protocols: ['trojan', 'hysteria2'], displayName: 'HT' });
    expect(validateNodeProxy({ server: '[2001:db8::1]' })).toEqual({ server: '2001:db8::1' });
  });

  it('rejects values that could not be written safely into a share link', () => {
    expect(() => validateNodeProxy({ server: 'bad host/evil' })).toThrow('连接域名');
    expect(() => validateNodeProxy({ server: 'a.example#frag' })).toThrow('连接域名');
    expect(() => validateNodeProxy({ sni: 'not a domain' })).toThrow('SNI');
    expect(() => validateNodeProxy({ certVerify: 'auto' })).toThrow('证书校验策略');
    expect(() => validateNodeProxy({ protocols: ['socks'] })).toThrow('不支持的出口协议');
    expect(() => validateNodeProxy({ displayName: 'a\nb' })).toThrow('订阅显示名称');
    expect(() => validateNodeProxy({ host: 'x' })).toThrow('未知字段');
    expect(() => validateNodeProxy('ht.example.com')).toThrow('节点出口设置无效');
  });
});

describe('applyNodeProxy', () => {
  it('exports the domain, SNI and strict verification while keeping port, password and other parameters byte-identical', () => {
    expect(applyNodeProxy(TROJAN, strict))
      .toBe('trojan://p%40ss@ht.example.com:8443?type=tcp&security=tls&sni=ht.example.com#233boy-trojan-203.0.113.7');
    expect(applyNodeProxy(HYSTERIA2, strict))
      .toBe('hysteria2://secret@ht.example.com:8444?alpn=h3&sni=ht.example.com#233boy-hysteria2-203.0.113.7');
    expect(applyNodeProxy('hy2://secret@203.0.113.7:8444?insecure=1#n', strict)).toBe('hy2://secret@ht.example.com:8444?sni=ht.example.com#n');
    expect(applyNodeProxy('tuic://id:pw@203.0.113.7:8445?sni=old.example&allow_insecure=1&congestion_control=bbr#t', strict))
      .toBe('tuic://id:pw@ht.example.com:8445?sni=ht.example.com&congestion_control=bbr#t');
  });

  it('never infers trust: without an explicit policy the kernel-reported verification flags survive', () => {
    // 只换域名（例如自签证书仍在用）——insecure 标记必须原样保留。
    expect(applyNodeProxy(TROJAN, { server: 'ht.example.com' }))
      .toBe('trojan://p%40ss@ht.example.com:8443?type=tcp&security=tls&allowInsecure=1&insecure=1#233boy-trojan-203.0.113.7');
    expect(applyNodeProxy(HYSTERIA2, { sni: 'ht.example.com' }))
      .toBe('hysteria2://secret@203.0.113.7:8444?alpn=h3&insecure=1&sni=ht.example.com#233boy-hysteria2-203.0.113.7');
    expect(applyNodeProxy(TROJAN, undefined)).toBe(TROJAN);
    expect(applyNodeProxy(TROJAN, { displayName: 'HT' })).toBe(TROJAN);
  });

  it('writes an explicit insecure policy for self-signed certificates', () => {
    expect(applyNodeProxy('trojan://pw@203.0.113.7:443?security=tls#t', { certVerify: 'insecure' }))
      .toBe('trojan://pw@203.0.113.7:443?security=tls&allowInsecure=1&insecure=1#t');
    expect(applyNodeProxy('hysteria2://pw@203.0.113.7:443#h', { certVerify: 'insecure' })).toBe('hysteria2://pw@203.0.113.7:443?insecure=1#h');
    expect(applyNodeProxy('tuic://id:pw@203.0.113.7:443#t', { certVerify: 'insecure' })).toBe('tuic://id:pw@203.0.113.7:443?allow_insecure=1&insecure=1#t');
  });

  it('leaves Reality and plaintext sessions without SNI or verification changes', () => {
    const reality = 'vless://id@203.0.113.7:443?type=tcp&security=reality&sni=www.apple.com&pbk=key&sid=ab#reality';
    expect(applyNodeProxy(reality, strict)).toBe('vless://id@ht.example.com:443?type=tcp&security=reality&sni=www.apple.com&pbk=key&sid=ab#reality');
    expect(applyNodeProxy('vless://id@203.0.113.7:443?type=tcp&security=tls&sni=old.example#tls', strict))
      .toBe('vless://id@ht.example.com:443?type=tcp&security=tls&sni=ht.example.com#tls');
    const ss = `ss://${Buffer.from('aes-256-gcm:pw').toString('base64url')}@203.0.113.7:8388#ss`;
    expect(applyNodeProxy(ss, strict)).toBe(ss.replace('203.0.113.7', 'ht.example.com'));
    expect(applyNodeProxy('trojan://pw@[2001:db8::7]:443?security=tls#v6', { server: '2001:db8::9' })).toBe('trojan://pw@[2001:db8::9]:443?security=tls#v6');
  });

  it('limits server, SNI and verification to the selected protocols', () => {
    const scoped: NodeProxyConfig = { ...strict, protocols: ['trojan'] };
    expect(applyNodeProxy(TROJAN, scoped)).toContain('@ht.example.com:8443');
    expect(applyNodeProxy(HYSTERIA2, scoped)).toBe(HYSTERIA2);
    expect(applyNodeProxy('hy2://secret@203.0.113.7:8444?insecure=1#n', { ...strict, protocols: ['hysteria2'] })).toContain('@ht.example.com:8444');
  });

  it('rewrites VMess JSON and keeps untouched links unchanged', () => {
    const encode = (value: Record<string, unknown>) => `vmess://${Buffer.from(JSON.stringify(value)).toString('base64')}`;
    const decode = (url: string) => JSON.parse(Buffer.from(url.slice(8), 'base64').toString('utf8')) as Record<string, unknown>;
    const tls = encode({ v: '2', ps: 'ws', add: '203.0.113.7', port: '443', id: 'uuid', net: 'ws', tls: 'tls' });
    expect(decode(applyNodeProxy(tls, strict))).toEqual({ v: '2', ps: 'ws', add: 'ht.example.com', port: '443', id: 'uuid', net: 'ws', tls: 'tls', sni: 'ht.example.com', insecure: '0', allowInsecure: '0' });
    const plain = encode({ v: '2', ps: 'tcp', add: '203.0.113.7', port: '80', id: 'uuid', net: 'tcp', tls: '' });
    expect(decode(applyNodeProxy(plain, strict))).toEqual({ v: '2', ps: 'tcp', add: 'ht.example.com', port: '80', id: 'uuid', net: 'tcp', tls: '' });
    expect(applyNodeProxy('vmess://not-json', strict)).toBe('vmess://not-json');
    expect(applyNodeProxy('trojan://pw@ht.example.com:443?#bare', { server: 'ht.example.com' })).toBe('trojan://pw@ht.example.com:443?#bare');
    expect(applyNodeProxy('wireguard://key@203.0.113.7:51820#wg', strict)).toBe('wireguard://key@203.0.113.7:51820#wg');
  });
});

describe('applyNodeDisplayNames', () => {
  it('names sources "<displayName> <protocol>" and numbers repeated protocols', () => {
    const base = { kernel: 'sing-box' as const, nodeId: 'ht', location: '香港', proxy: { displayName: 'HT' } };
    const vmess = `vmess://${Buffer.from(JSON.stringify({ v: '2', ps: 'old', add: 'a', port: '1', id: 'u' })).toString('base64')}`;
    const named = applyNodeDisplayNames([
      { ...base, url: TROJAN }, { ...base, url: HYSTERIA2 }, { ...base, url: 'hy2://pw@203.0.113.7:9000#second' }, { ...base, url: vmess },
      { url: 'trojan://pw@other.example:443#keep', kernel: 'xray', nodeId: 'other', location: '日本' },
    ]);
    expect(named.slice(0, 3).map(source => decodeURIComponent(source.url.slice(source.url.indexOf('#') + 1)))).toEqual(['HT Trojan', 'HT Hysteria2', 'HT Hysteria2 2']);
    expect(JSON.parse(Buffer.from(named[3]!.url.slice(8), 'base64').toString('utf8'))).toMatchObject({ ps: 'HT VMess', add: 'a' });
    expect(named[4]!.url).toBe('trojan://pw@other.example:443#keep');
  });
});

describe('node endpoint settings in generated artifacts', () => {
  async function generate(sources: CollectedProxySource[], localNodeProxy?: () => Promise<NodeProxyConfig | undefined>, local: string[] = []) {
    const root = await mkdtemp(join(tmpdir(), 'miobridge-core-node-proxy-')); roots.push(root);
    const config = { staticDir: join(root, 'www'), logDir: join(root, 'log'), backupDir: join(root, 'backup'), clashFilename: 'clash.yaml' };
    const service = new ArtifactService({
      config, logger, clash: mihomo(),
      local: { isAvailable: async () => local.length > 0, extractNodeUrls: async () => local },
      remote: { collectRemoteNodeSources: async () => ({ sources, errors: [] }) },
      ...(localNodeProxy ? { localNodeProxy } : {}),
    });
    const result = await service.updateSubscription();
    const raw = await readFile(join(config.staticDir, 'raw.txt'), 'utf8');
    const subscription = Buffer.from(await readFile(join(config.staticDir, 'subscription.txt'), 'utf8'), 'base64').toString('utf8');
    const clash = YAML.parse(await readFile(join(config.staticDir, 'clash.yaml'), 'utf8'));
    return { result, raw, subscription, clash };
  }

  it('publishes domain, SNI, strict verification and the display name to raw, Base64 and Clash, including policy groups', async () => {
    const proxy: NodeProxyConfig = { ...strict, displayName: 'HT' };
    const untouched = 'trojan://pw@198.51.100.9:443?security=tls&allowInsecure=1&insecure=1#233boy-trojan-198.51.100.9';
    const { raw, subscription, clash } = await generate([
      { url: TROJAN, kernel: 'sing-box', nodeId: 'ht', location: '香港', proxy },
      { url: HYSTERIA2, kernel: 'sing-box', nodeId: 'ht', location: '香港', proxy },
      { url: untouched, kernel: 'sing-box', nodeId: 'jp', location: '日本' },
    ]);

    expect(raw.split('\n')).toEqual([
      'trojan://p%40ss@ht.example.com:8443?type=tcp&security=tls&sni=ht.example.com#HT%20Trojan',
      'hysteria2://secret@ht.example.com:8444?alpn=h3&sni=ht.example.com#HT%20Hysteria2',
      untouched,
    ]);
    expect(subscription).toBe(raw);
    expect(clash.proxies).toEqual([
      { name: 'HT Trojan', type: 'trojan', server: 'ht.example.com', port: 8443, password: 'p@ss', network: 'tcp', 'skip-cert-verify': false, sni: 'ht.example.com' },
      { name: 'HT Hysteria2', type: 'hysteria2', server: 'ht.example.com', port: 8444, password: 'secret', 'skip-cert-verify': false, sni: 'ht.example.com', alpn: ['h3'] },
      // 未配置出口设置的节点保持原有行为：IP、跳过校验、地域前缀。
      { name: '日本 233boy-trojan-198.51.100.9', type: 'trojan', server: '198.51.100.9', port: 443, password: 'pw', network: 'tcp', 'skip-cert-verify': true },
    ]);
    // 重命名必须同步到策略组引用：模板占位符展开出的成员就是最终节点名。
    const names = clash.proxies.map((item: { name: string }) => item.name);
    const referencing = clash['proxy-groups'].filter((group: { proxies: string[] }) => group.proxies.includes('HT Trojan'));
    expect(referencing.length).toBeGreaterThan(0);
    for (const group of referencing) expect(group.proxies).toEqual(expect.arrayContaining(names));
    expect(JSON.stringify(clash['proxy-groups'])).not.toContain('233boy-trojan-203.0.113.7');
  });

  it('keeps an explicit insecure policy for self-signed certificates even when the domain and SNI are set', async () => {
    const { clash } = await generate([
      { url: 'hysteria2://secret@203.0.113.7:8444?alpn=h3#hy', kernel: 'sing-box', nodeId: 'ht', location: '香港', proxy: { server: 'ht.example.com', sni: 'ht.example.com', certVerify: 'insecure' } },
    ]);
    expect(clash.proxies[0]).toMatchObject({ server: 'ht.example.com', sni: 'ht.example.com', 'skip-cert-verify': true });
  });

  it('applies the local node profile to locally collected sources and rescues loopback endpoints', async () => {
    const { raw, result } = await generate([], async () => ({ server: 'main.example.com', certVerify: 'strict' }), [
      'trojan://pw@127.0.0.1:443?security=tls&insecure=1#local',
    ]);
    expect(raw).toBe('trojan://pw@main.example.com:443?security=tls#local');
    expect((result.warnings ?? []).filter(warning => warning.includes('不可路由'))).toEqual([]);
  });

  it('persists settings in nodes.yaml and attaches them to every source of the node', async () => {
    const store = memoryStore('nodes:\n  - id: ht\n    name: HT\n    host: 203.0.113.7\n    secret: secret\n    kernels:\n      - type: sing-box\n    location: 香港\n    enabled: true\n');
    const repository = new NodeRepository(store);
    await repository.update('ht', current => ({ ...current, proxy: { ...strict, displayName: 'HT' } }));

    // 重新构造仓库 = dashboard 重启；Agent 管理地址不受出口域名影响。
    const reloaded = new NodeRepository(store);
    expect((await reloaded.list())[0]).toMatchObject({ host: '203.0.113.7', proxy: { ...strict, displayName: 'HT' } });

    const requested: string[] = [];
    const client = new AgentClient({ fetch: (async (input: string | URL | Request) => {
      requested.push(String(input));
      const kernels = [
        { type: 'sing-box', detected: true, monitored: true, accessible: true, nodesCount: 2, configPaths: ['/etc/sing-box/conf/a.json'] },
        { type: 'xray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
        { type: 'v2ray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
      ];
      return new Response(JSON.stringify({ data: { kernels, sources: [{ kernel: 'sing-box', url: TROJAN }, { kernel: 'sing-box', url: HYSTERIA2 }] } }), { status: 200 });
    }) as typeof fetch });
    const aggregation = new NodeAggregationService(reloaded, client);
    const collected = await aggregation.collectRemoteNodeSources();
    expect(collected.sources.map(source => source.proxy)).toEqual([{ ...strict, displayName: 'HT' }, { ...strict, displayName: 'HT' }]);
    expect(requested.every(url => url.startsWith('http://203.0.113.7:3001/'))).toBe(true);
    expect((await aggregation.getClusterStatus()).nodes[0]).toMatchObject({ host: '203.0.113.7', proxy: { ...strict, displayName: 'HT' } });

    await expect(reloaded.update('ht', current => ({ ...current, proxy: { certVerify: 'auto' as never } }))).rejects.toThrow('证书校验策略');
    const cleared = await reloaded.update('ht', current => ({ ...current, proxy: {} }));
    expect(cleared).not.toHaveProperty('proxy');
    expect(await store.get('nodes.yaml')).not.toContain('proxy');
  });
});
