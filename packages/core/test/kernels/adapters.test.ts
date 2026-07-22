import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import {
  MihomoAdapter,
  SingBoxAdapter,
  buildClashSubscription,
  buildClashSubscriptionResult,
  createRuntimePaths,
  type KernelFileSystem,
  type ProcessOptions,
  type ProcessRunner,
} from '../../src/index.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

class MemoryFs implements KernelFileSystem {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();
  async exists(path: string) { return this.files.has(path); }
  async mkdir(path: string) { this.directories.add(path); }
  async readFile(path: string) { return this.files.get(path) ?? ''; }
  async writeFile(path: string, content: string) { this.files.set(path, content); }
  async remove(path: string) { this.files.delete(path); }
}

class FakeProcess implements ProcessRunner {
  readonly calls: Array<{ command: string; args: readonly string[]; options: ProcessOptions }> = [];
  constructor(private readonly found: string | null = null) {}
  async run(command: string, args: readonly string[], options: ProcessOptions) {
    this.calls.push({ command, args, options });
    if (args[0] === '-v') return { stdout: 'Mihomo v1.19.3', stderr: '' };
    if (args[0] === 'help') return { stdout: 'url [name] URL information', stderr: '' };
    if (args[0] === 'url') return { stdout: `${args[1]}://node\n`, stderr: '' };
    return { stdout: 'ok', stderr: '' };
  }
  async which() { return this.found; }
}

describe('source normalization', () => {
  it('preserves exact-url deduplication and collision-safe names', () => {
    const first = { url: 'vless://id@a:443#node', kernel: 'sing-box' as const, nodeId: 'a', location: '香港' };
    const second = { url: 'vless://id2@b:443#node', kernel: 'xray' as const, nodeId: 'b', location: '香港' };
    const output = decodeURIComponent(buildClashSubscription([first, first, second]));
    expect(output.split('\n')).toHaveLength(2);
    expect(output).toContain(`香港 node [${first.url}]`);
    expect(output).toContain(`香港 node [${second.url}]`);
  });

  it('isolates malformed VMess without exposing unrelated sources', () => {
    const result = buildClashSubscriptionResult([
      { url: 'vmess://not-json', kernel: 'xray', nodeId: 'broken', location: '香港' },
      { url: 'trojan://secret@ok:443#usable', kernel: 'sing-box', nodeId: 'ok', location: '日本' },
    ]);
    expect(result.content).toContain('trojan://secret@ok:443');
    expect(result.errors[0]).toContain('broken');
  });
});

describe('kernel adapters', () => {
  it('runs sing-box with argument arrays and retains source ordering', async () => {
    const process = new FakeProcess();
    const adapter = new SingBoxAdapter({ process, logger, configs: ['a', 'b'], requestTimeout: 1234 });
    expect(await adapter.extractNodeUrls()).toEqual(['a://node', 'b://node']);
    expect(process.calls.map(call => call.args)).toEqual([['help'], ['url', 'a'], ['url', 'b']]);
  });

  it('uses RuntimePaths precedence when resolving sing-box', async () => {
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: '/state', PATH: '/one' }, applicationRoot: '/app' });
    const process = new FakeProcess();
    const adapter = new SingBoxAdapter({ process, logger, paths, configs: [], requestTimeout: 1234 });
    expect(await adapter.isAvailable()).toBe(true);
    expect(process.calls[0]?.command).toBe('/state/bin/sing-box');
  });

  it('skips an official sing-box core that does not provide the 233boy url command', async () => {
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: '/state', PATH: '/usr/local/bin' } });
    const calls: string[] = [];
    const process: ProcessRunner = {
      async run(command, args) {
        calls.push(`${command} ${args.join(' ')}`);
        if (command === '/state/bin/sing-box') return { stdout: 'Usage: sing-box [command]', stderr: '' };
        return { stdout: 'url [name] URL information', stderr: '' };
      },
      async which() { return null; },
    };
    const adapter = new SingBoxAdapter({ process, logger, paths, configs: [], requestTimeout: 1234 });
    expect(await adapter.isAvailable()).toBe(true);
    expect(calls).toEqual([
      '/state/bin/sing-box help',
      '/usr/local/bin/sing-box help',
    ]);
  });

  it.each(['/repo', '/tmp/unrelated'])('uses managed, explicit repository, then PATH candidates independent of cwd (%s)', async () => {
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: '/state', PATH: '/one:/two' }, applicationRoot: '/app' });
    const adapter = new MihomoAdapter({ paths, process: new FakeProcess(), fs: new MemoryFs(), logger, runtimeDir: '/runtime' });
    expect(adapter.binaryCandidates()).toEqual(['/state/bin/mihomo', '/app/bin/mihomo', '/one/mihomo', '/two/mihomo']);
  });

  it('validates generated YAML with unchanged mihomo arguments and removes the temporary file', async () => {
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: '/state', PATH: '' }, applicationRoot: '/app' });
    const fs = new MemoryFs();
    fs.files.set('/state/bin/mihomo', 'binary');
    const process = new FakeProcess();
    const adapter = new MihomoAdapter({ paths, process, fs, logger, runtimeDir: '/runtime' });
    const output = await adapter.convertToClashByContent('vless://id@example.com:443?type=tcp&security=tls#node');
    expect(YAML.parse(output).proxies[0]).toMatchObject({ name: 'node', type: 'vless' });
    expect(process.calls.at(-1)?.args).toEqual(['-d', '/runtime', '-t', '-f', '/state/mihomo/temp-config.yaml']);
    expect(fs.files.has('/state/mihomo/temp-config.yaml')).toBe(false);
  });

  it('preserves Reality and WebSocket parameters and uses safe default routing rules', async () => {
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: '/state', PATH: '' }, applicationRoot: '/app' });
    const fs = new MemoryFs();
    fs.files.set('/state/bin/mihomo', 'binary');
    const adapter = new MihomoAdapter({ paths, process: new FakeProcess(), fs, logger, runtimeDir: '/runtime' });
    const output = YAML.parse(await adapter.convertToClashByContent(
      'vless://id@example.com:443?type=ws&security=reality&sni=ai.example&pbk=public&sid=abcd&flow=xtls-rprx-vision&path=%2Fws&host=cdn.example#reality',
    ));
    expect(output.proxies[0]).toMatchObject({
      type: 'vless', tls: true, flow: 'xtls-rprx-vision',
      'reality-opts': { 'public-key': 'public', 'short-id': 'abcd' },
      'ws-opts': { path: '/ws', headers: { Host: 'cdn.example' } },
    });
    expect(output.rules).toContain('GEOIP,CN,DIRECT,no-resolve');
    expect(output.rules).toContain('IP-CIDR6,fc00::/7,DIRECT,no-resolve');
    expect(output.rules).not.toContain('IP-CIDR,17.0.0.0/8,DIRECT');
  });

  it('renders every input node into the complete Clash template without replacing routing rules', async () => {
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: '/state', PATH: '' }, applicationRoot: '/app' });
    const fs = new MemoryFs();
    fs.files.set('/state/bin/mihomo', 'binary');
    const process = new FakeProcess();
    const adapter = new MihomoAdapter({ paths, process, fs, logger, runtimeDir: '/runtime' });
    const output = YAML.parse(await adapter.convertToClashByContent([
      'hysteria2://password@hy.example:443?sni=hy.example&alpn=h3#hy2',
      'trojan://password@trojan.example:443?sni=trojan.example#trojan',
    ].join('\n')));

    expect(output.proxies).toHaveLength(2);
    expect(output.dns).toMatchObject({ enable: true, 'enhanced-mode': 'fake-ip' });
    expect(output['proxy-groups'].map((group: any) => group.name)).toEqual([
      '🚀 节点选择', '🤖 AI 服务', '♻️ 自动选择', '🔯 故障转移', '🔮 负载均衡', '🎯 全球直连', '🐟 漏网之鱼',
    ]);
    expect(output['proxy-groups'][0].proxies).toEqual(expect.arrayContaining(['hy2', 'trojan']));
    expect(output.rules).toContain('GEOSITE,category-ai-!cn,🤖 AI 服务');
    expect(output.rules.at(-1)).toBe('MATCH,🐟 漏网之鱼');
    // 首次校验可能要下载 geodata（GEOSITE 规则前置），30s 不够。
    expect(process.calls.at(-1)?.options.timeout).toBe(120_000);
  });

  it('suffixes duplicate proxy names so mihomo does not reject the whole config', async () => {
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: '/state', PATH: '' }, applicationRoot: '/app' });
    const fs = new MemoryFs();
    fs.files.set('/state/bin/mihomo', 'binary');
    const adapter = new MihomoAdapter({ paths, process: new FakeProcess(), fs, logger, runtimeDir: '/runtime' });
    // 同机多端口、ps 相同的 vmess 是真实场景（233boy 多协议脚本）——名字相同但确为不同代理。
    const vmess = (port: number, id: string) => `vmess://${Buffer.from(JSON.stringify({ v: 2, ps: 'same-name', add: 'dup.example', port: String(port), id, aid: '0', net: 'tcp' })).toString('base64')}`;
    const output = YAML.parse(await adapter.convertToClashByContent([vmess(3689, 'id-a'), vmess(41423, 'id-b'), 'trojan://secret@dup.example:443#same-name'].join('\n')));
    const names = output.proxies.map((proxy: any) => proxy.name);
    expect(names).toEqual(['same-name', 'same-name 2', 'same-name 3']);
    for (const group of output['proxy-groups'].filter((g: any) => g.proxies.includes('same-name'))) {
      expect(group.proxies).toEqual(expect.arrayContaining(names));
    }
  });

  it('keeps proxy groups acyclic — mihomo rejects mutually referencing groups as a loop', async () => {
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: '/state', PATH: '' }, applicationRoot: '/app' });
    const fs = new MemoryFs();
    fs.files.set('/state/bin/mihomo', 'binary');
    const adapter = new MihomoAdapter({ paths, process: new FakeProcess(), fs, logger, runtimeDir: '/runtime' });
    const output = YAML.parse(await adapter.convertToClashByContent('trojan://secret@ok.example:443#ok'));
    const groups = new Map<string, string[]>(output['proxy-groups'].map((g: any) => [g.name, g.proxies]));
    // AI 组引用主选组是刻意保留的回退方向；反向引用会成环，曾让 mihomo 拒绝整份配置。
    expect(groups.get('🤖 AI 服务')).toContain('🚀 节点选择');
    expect(groups.get('🚀 节点选择')).not.toContain('🤖 AI 服务');
    // 通用环检测：沿组间引用走一遍，任何组不可达自身。
    const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
      if (seen.has(from)) return false;
      seen.add(from);
      return (groups.get(from) ?? []).some(member => member === target || (groups.has(member) && reaches(member, target, seen)));
    };
    for (const name of groups.keys()) expect({ group: name, cyclic: reaches(name, name) }).toEqual({ group: name, cyclic: false });
  });

  it('rejects a partial conversion instead of publishing fewer proxies than the input', async () => {
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: '/state', PATH: '' }, applicationRoot: '/app' });
    const fs = new MemoryFs();
    fs.files.set('/state/bin/mihomo', 'binary');
    const adapter = new MihomoAdapter({ paths, process: new FakeProcess(), fs, logger, runtimeDir: '/runtime' });
    await expect(adapter.convertToClashByContent([
      'trojan://password@ok.example:443#ok',
      'wireguard://unsupported@example:443#not-silently-dropped',
    ].join('\n'))).rejects.toThrow('1/2 个代理节点无法转换');
  });

  it('falls back to PATH discovery and reports mihomo availability', async () => {
    const paths = createRuntimePaths({ env: { MIOBRIDGE_CONFIG_DIR: '/state', PATH: '' } });
    const process = new FakeProcess('/usr/bin/mihomo');
    const adapter = new MihomoAdapter({ paths, process, fs: new MemoryFs(), logger, runtimeDir: '/runtime' });
    expect(await adapter.ensureMihomoAvailable()).toBe(true);
    expect(process.calls[0]?.command).toBe('/usr/bin/mihomo');
  });
});
