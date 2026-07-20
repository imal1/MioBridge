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
      '🚀 节点选择', '♻️ 自动选择', '🔯 故障转移', '🔮 负载均衡', '🎯 全球直连', '🐟 漏网之鱼',
    ]);
    expect(output['proxy-groups'][0].proxies).toEqual(expect.arrayContaining(['hy2', 'trojan']));
    expect(output.rules).toContain('DOMAIN-SUFFIX,openai.com,♻️ 自动选择');
    expect(output.rules.at(-1)).toBe('MATCH,♻️ 自动选择');
    expect(process.calls.at(-1)?.options.timeout).toBe(30_000);
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
