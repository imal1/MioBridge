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
const NODE_PLACEHOLDER = '__MIOBRIDGE_NODES__';

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
  getTemplatePath(): string { return this.options.paths.templateFile; }
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
    const document = await this.loadTemplate();
    document.set('proxies', proxies);
    this.injectProxyNames(document, names);
    const yaml = document.toString({ lineWidth: 0 });
    const output = `# Clash 配置文件\n# 由 miobridge 生成，mihomo 可用时自动验证\n# 生成时间: ${new Date().toISOString()}\n# 节点数量: ${proxies.length}\n\n${yaml}`;
    await this.validate(output);
    return output;
  }
  private async loadTemplate(): Promise<YAML.Document.Parsed> {
    const path = this.getTemplatePath();
    if (!await this.options.fs.exists(path)) {
      throw new Error(`Mihomo YAML 模板不存在: ${path}；请重新安装 MioBridge 或创建该文件`);
    }
    const source = await this.options.fs.readFile(path);
    const document = YAML.parseDocument(source, { prettyErrors: true, uniqueKeys: true });
    if (document.errors.length > 0) throw new Error(`Mihomo 模板 YAML 无效: ${document.errors[0]?.message}`);
    const value = document.toJS({ maxAliasCount: 50 }) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Mihomo 模板根节点必须是对象');
    const config = value as Record<string, unknown>;
    if ('proxies' in config) throw new Error('Mihomo 模板字段 proxies 由 MioBridge 动态管理，请从模板中删除');
    if (!Array.isArray(config['proxy-groups']) || config['proxy-groups'].length === 0) {
      throw new Error('Mihomo 模板 proxy-groups 必须是非空数组');
    }
    if (!Array.isArray(config.rules) || config.rules.length === 0
      || config.rules.some(rule => typeof rule !== 'string' || !rule.trim())) {
      throw new Error('Mihomo 模板 rules 必须是非空字符串数组');
    }
    return document;
  }
  private injectProxyNames(document: YAML.Document.Parsed, names: readonly string[]): void {
    const groups = document.get('proxy-groups', true);
    if (!YAML.isSeq(groups)) throw new Error('Mihomo 模板 proxy-groups 必须是数组');
    let placeholders = 0;
    for (const group of groups.items) {
      if (!YAML.isMap(group)) throw new Error('Mihomo 模板 proxy-groups 的每一项必须是对象');
      const members = group.get('proxies', true);
      if (!YAML.isSeq(members)) throw new Error('Mihomo 模板中每个策略组的 proxies 必须是数组');
      for (let index = members.items.length - 1; index >= 0; index -= 1) {
        const member = members.items[index];
        if (!YAML.isScalar(member) || member.value !== NODE_PLACEHOLDER) continue;
        members.items.splice(index, 1, ...names.map(name => document.createNode(name)));
        placeholders += 1;
      }
    }
    if (placeholders === 0) {
      throw new Error(`Mihomo 模板至少需要一个 ${NODE_PLACEHOLDER} 节点占位符`);
    }
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
