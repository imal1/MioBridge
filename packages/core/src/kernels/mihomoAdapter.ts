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
  'DOMAIN-SUFFIX,cn,DIRECT',
  'GEOIP,CN,DIRECT,no-resolve',
  'DOMAIN-SUFFIX,openai.com,♻️ 自动选择',
  'DOMAIN-SUFFIX,chatgpt.com,♻️ 自动选择',
  'DOMAIN-SUFFIX,oaistatic.com,♻️ 自动选择',
  'DOMAIN-SUFFIX,oaiusercontent.com,♻️ 自动选择',
  'DOMAIN-SUFFIX,anthropic.com,♻️ 自动选择',
  'DOMAIN-SUFFIX,claude.ai,♻️ 自动选择',
  'DOMAIN-SUFFIX,gemini.google.com,♻️ 自动选择',
  'DOMAIN-SUFFIX,ai.google.dev,♻️ 自动选择',
  'DOMAIN-SUFFIX,generativeai.google.com,♻️ 自动选择',
  'DOMAIN-SUFFIX,githubcopilot.com,♻️ 自动选择',
  'DOMAIN-SUFFIX,copilot.github.com,♻️ 自动选择',
  'DOMAIN-SUFFIX,deepseek.com,♻️ 自动选择',
  'DOMAIN-SUFFIX,groq.com,♻️ 自动选择',
  'DOMAIN-SUFFIX,perplexity.ai,♻️ 自动选择',
  'DOMAIN-SUFFIX,mistral.ai,♻️ 自动选择',
  'MATCH,♻️ 自动选择',
] as const;

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
    const proxies = content.split('\n').map(line => line.trim()).filter(Boolean).map(line => this.parse(line)).filter((value): value is ProxyConfig => value !== null);
    if (proxies.length === 0) throw new Error('未找到有效的代理节点');
    const names = proxies.map(proxy => proxy.name);
   const yaml = YAML.stringify({ port: 7890, 'socks-port': 7891, 'allow-lan': false, mode: 'rule', 'log-level': 'info', 'external-controller': '127.0.0.1:9090', proxies, 'proxy-groups': [
      { name: '♻️ 自动选择', type: 'url-test', proxies: names, url: 'http://www.gstatic.com/generate_204', interval: 300 },
      { name: '🔯 故障转移', type: 'fallback', proxies: names, url: 'http://www.gstatic.com/generate_204', interval: 300 },
      { name: '🔮 负载均衡', type: 'load-balance', proxies: names, url: 'http://www.gstatic.com/generate_204', interval: 300 },
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
      if (network === 'ws') proxy['ws-opts'] = { path: url.searchParams.get('path') || '/', ...(url.searchParams.get('host') ? { headers: { Host: url.searchParams.get('host')! } } : {}) };
      if (network === 'grpc') proxy['grpc-opts'] = { 'grpc-service-name': url.searchParams.get('serviceName') || url.searchParams.get('service_name') || '' };
      return proxy;
    } catch { return null; }
  }
  private async validate(config: string): Promise<void> {
    const executable = this.executable ?? await this.findExecutable();
    if (!executable) throw new Error('mihomo 不可用，无法验证 Clash 配置');
    const configDir = this.options.paths.managedPath('mihomo');
    const temp = join(configDir, 'temp-config.yaml');
    await this.options.fs.mkdir(configDir);
    await this.options.fs.writeFile(temp, config);
    try { await this.options.process.run(executable, ['-d', this.options.runtimeDir, '-t', '-f', temp], this.processOptions(10000)); }
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
