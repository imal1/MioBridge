import { join } from 'node:path';
import YAML from 'yaml';
import type { RuntimePaths } from '../runtime/runtimePaths.js';
import type { KernelFileSystem, KernelLogger, ProcessRunner } from './ports.js';

export interface MihomoAdapterOptions {
  readonly paths: RuntimePaths;
  readonly process: ProcessRunner;
  readonly fs: KernelFileSystem;
  readonly logger: KernelLogger;
  readonly runtimeDir: string;
  readonly configuredPath?: string;
  readonly envPath?: string;
}
interface ProxyConfig { name: string; type: string; server: string; port: number; [key: string]: unknown }

const DNS_CONFIG = {
  enable: true,
  listen: '0.0.0.0:53',
  'default-nameserver': ['223.5.5.5', '119.29.29.29'],
  'enhanced-mode': 'fake-ip',
  'fake-ip-range': '198.18.0.1/16',
  nameserver: ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'],
} as const;

// 内网 / 本机：非 GEOSITE 规则，geodata 未加载时仍可用，保证冷启动可 bootstrap 下载 geodata
const DEFAULT_RULES = [
  'DOMAIN-SUFFIX,local,DIRECT',
  'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
  'IP-CIDR,169.254.0.0/16,DIRECT,no-resolve',
  'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
  'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
  'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
  'IP-CIDR,100.64.0.0/10,DIRECT,no-resolve',
  'IP-CIDR6,::1/128,DIRECT,no-resolve',
  'IP-CIDR6,fc00::/7,DIRECT,no-resolve',
  'IP-CIDR6,fe80::/10,DIRECT,no-resolve',
  // 广告拦截
  'GEOSITE,category-ads-all,REJECT',
  // Google AI Studio / Gemini 精确入口（放 category-ai / google 之前）
  'DOMAIN,aistudio.google.com,🤖 AI 服务',
  'DOMAIN,gemini.google.com,🤖 AI 服务',
  'DOMAIN,alkalimakersuite-pa.clients6.google.com,🤖 AI 服务',
  'DOMAIN,generativelanguage.googleapis.com,🤖 AI 服务',
  'DOMAIN,ai.google.dev,🤖 AI 服务',
  // 海外 AI（Claude / OpenAI / Gemini / Perplexity / Mistral 等非中国大陆）
  'GEOSITE,category-ai-!cn,🤖 AI 服务',
  // Google 兜底（登录 / OAuth / APIs / gstatic 等）
  'GEOSITE,google,🚀 节点选择',
  // Cloudflare
  'GEOSITE,cloudflare,🚀 节点选择',
  // 开发服务
  'GEOSITE,github,🚀 节点选择',
  'GEOSITE,docker,🚀 节点选择',
  // 常见海外服务
  'GEOSITE,microsoft,🚀 节点选择',
  'GEOSITE,telegram,🚀 节点选择',
  'GEOSITE,discord,🚀 节点选择',
  // 流媒体
  'GEOSITE,youtube,🚀 节点选择',
  'GEOSITE,netflix,🚀 节点选择',
  'GEOSITE,spotify,🚀 节点选择',
  // 境外社媒（含 twitter / tiktok / reddit 等）
  'GEOSITE,category-social-media-!cn,🚀 节点选择',
  // 加密货币（交易所 / 行情）
  'GEOSITE,category-cryptocurrency,🚀 节点选择',
  // 成人内容
  'GEOSITE,category-porn,🚀 节点选择',
  // 学术（IEEE / Springer / arXiv 等）
  'GEOSITE,category-scholar-!cn,🚀 节点选择',
  // Apple
  'GEOSITE,apple-cn,DIRECT',
  'GEOSITE,apple,DIRECT',
  // 开发者站点（置于 apple 之后，避免 category-dev 内的 apple.com 覆盖上面的直连）
  'GEOSITE,category-dev,🚀 节点选择',
  // 国内域名和 IP
  'GEOSITE,cn,DIRECT',
  'GEOIP,CN,DIRECT,no-resolve',
  // 漏网之鱼
  'MATCH,🐟 漏网之鱼',
] as const;

// GeoData：MetaCubeX/meta-rules-dat，支持自动更新。
// 用 jsdelivr 镜像而非 github releases：客户端首次加载 geodata 时代理尚未就绪（鸡生蛋），
// github 直连在国内网络下载常超时（实测 90s 不完），jsdelivr 数秒即达；内容与 @release 分支一致。
const GEO_CONFIG = {
  'geodata-mode': true,
  'geodata-loader': 'memconservative',
  'geo-auto-update': true,
  'geo-update-interval': 24,
  'geox-url': {
    geoip: 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip-lite.dat',
    geosite: 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat',
    mmdb: 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/country-lite.mmdb',
    asn: 'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/GeoLite2-ASN.mmdb',
  },
} as const;

function normalizedBinary(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.endsWith('/mihomo') || trimmed === 'mihomo' ? trimmed : join(trimmed, 'mihomo');
}

export class MihomoAdapter {
  private executable?: string;
  constructor(private readonly options: MihomoAdapterOptions) {}

  binaryCandidates(): readonly string[] {
    return [...new Set([normalizedBinary(this.options.envPath), normalizedBinary(this.options.configuredPath), ...this.options.paths.binaryCandidates('mihomo')].filter((v): v is string => Boolean(v)))];
  }
  private async findExecutable(): Promise<string | null> {
    for (const candidate of this.binaryCandidates()) if (await this.options.fs.exists(candidate)) return candidate;
    return this.options.process.which('mihomo');
  }
  private processOptions(timeout: number) {
    const dir = this.options.runtimeDir;
    return { timeout, cwd: dir, env: { ...process.env, HOME: dir, XDG_CONFIG_HOME: dir, XDG_CACHE_HOME: dir, XDG_DATA_HOME: dir } };
  }
  async ensureMihomoAvailable(): Promise<boolean> {
    try {
      const executable = await this.findExecutable();
      if (!executable) return false;
      this.executable = executable;
      await this.options.fs.mkdir(this.options.runtimeDir);
      await this.options.process.run(executable, ['-v'], this.processOptions(5000));
      return true;
    } catch (error) {
      this.options.logger.error('检查本地 mihomo 失败', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }
  async checkHealth(): Promise<boolean> { return this.ensureMihomoAvailable(); }
  async getVersion(): Promise<{ version: string; build_time: string; commit: string } | null> {
    try {
      const executable = await this.findExecutable();
      if (!executable) throw new Error('mihomo 不可用');
      const { stdout } = await this.options.process.run(executable, ['-v'], this.processOptions(5000));
      const version = stdout.match(/\bv?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0]
        ?? stdout.match(/Mihomo\s+(?:Meta\s+)?(\S+)/i)?.[1] ?? 'unknown';
      return { version, build_time: new Date().toISOString(), commit: 'unknown' };
    } catch (error) { this.options.logger.error('获取 mihomo 版本失败', { error: String(error) }); return null; }
  }
  async convertToClashByContent(content: string): Promise<string> {
    const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
    const parsed = lines.map(line => ({ line, proxy: this.parse(line) }));
    const rejected = parsed.filter(item => item.proxy === null);
    if (rejected.length > 0) {
      const protocols = [...new Set(rejected.map(item => item.line.split('://')[0] || 'unknown'))];
      throw new Error(`有 ${rejected.length}/${lines.length} 个代理节点无法转换（协议: ${protocols.join(', ')}）`);
    }
    const proxies = parsed.map(item => item.proxy).filter((value): value is ProxyConfig => value !== null);
    if (proxies.length === 0) throw new Error('未找到有效的代理节点');
    // 不同代理可能共用同一显示名（如同机多端口、ps 相同的 vmess），而 mihomo 把重名当非法配置直接拒绝；
    // 为后续重名追加序号，首个保留原名，保证全部节点都能进入产物。
    const used = new Set<string>();
    for (const proxy of proxies) {
      let name = proxy.name;
      for (let i = 2; used.has(name); i += 1) name = `${proxy.name} ${i}`;
      proxy.name = name;
      used.add(name);
    }
    const names = proxies.map(proxy => proxy.name);
    const yaml = YAML.stringify({ port: 7890, 'socks-port': 7891, 'allow-lan': false, mode: 'rule', 'log-level': 'info', 'external-controller': '127.0.0.1:9090', ...GEO_CONFIG, dns: DNS_CONFIG, proxies, 'proxy-groups': [
      // 注意别把 '🤖 AI 服务' 加回来：AI 组已引用本组，互引会被 mihomo 判定 ProxyGroup loop 而拒绝整份配置。
      { name: '🚀 节点选择', type: 'select', proxies: ['♻️ 自动选择', '🔯 故障转移', '🔮 负载均衡', '🎯 全球直连', ...names] },
      { name: '🤖 AI 服务', type: 'select', proxies: ['♻️ 自动选择', '🔯 故障转移', '🚀 节点选择', ...names] },
      { name: '♻️ 自动选择', type: 'url-test', proxies: names, url: 'http://cp.cloudflare.com/generate_204', interval: 300, tolerance: 50, lazy: true },
      { name: '🔯 故障转移', type: 'fallback', proxies: names, url: 'http://cp.cloudflare.com/generate_204', interval: 300, lazy: true },
      { name: '🔮 负载均衡', type: 'load-balance', proxies: names, url: 'http://cp.cloudflare.com/generate_204', interval: 300, lazy: true, strategy: 'round-robin' },
      { name: '🎯 全球直连', type: 'select', proxies: ['DIRECT'] },
      { name: '🐟 漏网之鱼', type: 'select', proxies: ['🚀 节点选择', '🎯 全球直连', '♻️ 自动选择'] },
    ], rules: DEFAULT_RULES }, { lineWidth: 0 });
    const output = `# Clash 配置文件\n# 由 miobridge 生成，mihomo 可用时自动验证\n# 生成时间: ${new Date().toISOString()}\n# 节点数量: ${proxies.length}\n\n${yaml}`;
    await this.validate(output);
    return output;
  }
  private parse(line: string): ProxyConfig | null {
    try {
      if (line.startsWith('vmess://')) {
        const v = JSON.parse(Buffer.from(line.slice(8), 'base64').toString()) as Record<string, string>;
        const network = v.net || 'tcp';
        const proxy: ProxyConfig = { name: v.ps || `vmess-${v.add}`, type: 'vmess', server: v.add!, port: Number(v.port), uuid: v.id, alterId: Number(v.aid) || 0, cipher: v.scy || 'auto', network, tls: v.tls === 'tls', 'skip-cert-verify': true };
        if (v.sni) proxy.servername = v.sni;
        if (network === 'ws') proxy['ws-opts'] = { path: v.path || '/', ...(v.host ? { headers: { Host: v.host } } : {}) };
        return proxy;
      }
      const protocol = line.split('://')[0];
      if (!['vless', 'trojan', 'hysteria2', 'hy2', 'tuic', 'ss'].includes(protocol!)) return null;
      const url = new URL(protocol === 'hy2' ? line.replace(/^hy2:/, 'hysteria2:') : line);
      const type = protocol === 'hy2' ? 'hysteria2' : protocol!;
      const proxy: ProxyConfig = { name: decodeURIComponent(url.hash.slice(1)) || `${type}-${url.hostname}`, type, server: url.hostname, port: Number(url.port) || 443 };
      const network = url.searchParams.get('type') || 'tcp';
      if (type === 'vless') {
        const security = url.searchParams.get('security') || 'none';
        Object.assign(proxy, { uuid: decodeURIComponent(url.username), network, tls: security === 'tls' || security === 'reality', 'skip-cert-verify': url.searchParams.get('insecure') === '1' });
        const flow = url.searchParams.get('flow'); if (flow) proxy.flow = flow;
        if (security === 'reality') {
          proxy['client-fingerprint'] = url.searchParams.get('fp') || 'chrome';
          proxy['reality-opts'] = { 'public-key': url.searchParams.get('pbk') || '', 'short-id': url.searchParams.get('sid') || '' };
        }
      }
      else if (type === 'tuic') Object.assign(proxy, { uuid: url.username, password: url.password, 'skip-cert-verify': url.searchParams.get('allow_insecure') === '1' });
      else if (type === 'ss') { const [cipher, password] = Buffer.from(url.username, 'base64').toString().split(':'); Object.assign(proxy, { cipher, password }); }
      else Object.assign(proxy, { password: decodeURIComponent(url.username), ...(type === 'trojan' ? { network } : {}), 'skip-cert-verify': url.searchParams.get('insecure') === '1' });
      const sni = url.searchParams.get('sni'); if (sni) proxy[type === 'vless' ? 'servername' : 'sni'] = sni;
      const alpn = url.searchParams.get('alpn'); if (alpn) proxy.alpn = alpn.split(',').filter(Boolean);
      if (type === 'hysteria2') {
        const obfs = url.searchParams.get('obfs'); if (obfs) proxy.obfs = obfs;
        const obfsPassword = url.searchParams.get('obfs-password') || url.searchParams.get('obfs_password'); if (obfsPassword) proxy['obfs-password'] = obfsPassword;
        const up = url.searchParams.get('up') || url.searchParams.get('upmbps'); if (up) proxy.up = up;
        const down = url.searchParams.get('down') || url.searchParams.get('downmbps'); if (down) proxy.down = down;
      }
      if (type === 'tuic') {
        const congestion = url.searchParams.get('congestion_control') || url.searchParams.get('congestion-controller'); if (congestion) proxy['congestion-controller'] = congestion;
      }
      if (network === 'ws') proxy['ws-opts'] = { path: url.searchParams.get('path') || '/', ...(url.searchParams.get('host') ? { headers: { Host: url.searchParams.get('host')! } } : {}) };
      if (network === 'grpc') proxy['grpc-opts'] = { 'grpc-service-name': url.searchParams.get('serviceName') || url.searchParams.get('service_name') || '' };
      return proxy;
    } catch { return null; }
  }
  private async validate(config: string): Promise<void> {
    const executable = this.executable ?? await this.findExecutable();
    // 校验是可选增强，不是生成的前置：mihomo 不存在就跳过校验、保留已生成的配置，
    // 而非让整个 Clash 生成失败。mihomo 存在却校验不过（配置真非法）才向上抛错。
    if (!executable) { this.options.logger.warn('mihomo 不可用，跳过 Clash 配置校验'); return; }
    const configDir = this.options.paths.managedPath('mihomo');
    const temp = join(configDir, 'temp-config.yaml');
    await this.options.fs.mkdir(configDir);
    await this.options.fs.writeFile(temp, config);
    // 首次校验需下载 geodata（GEOSITE/GEOIP 规则的前置），30s 常不够；下载完成后有缓存，后续校验秒回。
    try { await this.options.process.run(executable, ['-d', this.options.runtimeDir, '-t', '-f', temp], this.processOptions(120_000)); }
    catch (error) { throw new Error(`配置验证失败: ${error instanceof Error ? error.message : String(error)}`); }
    finally { await this.options.fs.remove(temp); }
  }

  async testConversion(): Promise<{ success: boolean; message: string; version?: string }> {
    try {
      const available = await this.ensureMihomoAvailable();
      if (!available) return { success: false, message: 'mihomo 不可用' };
      const versionInfo = await this.getVersion();
      return { success: true, message: 'mihomo 转换正常', ...(versionInfo?.version ? { version: versionInfo.version } : {}) };
    } catch (error) {
      return { success: false, message: `测试失败: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}
