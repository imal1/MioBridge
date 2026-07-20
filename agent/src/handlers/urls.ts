import {
  SUPPORTED_KERNELS,
  type AgentConfig,
  type AgentKernelConfig,
  type KernelType,
} from '../config';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { hmacVerify } from '../hmac';

interface IncomingRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

const SING_BOX_CONFIG_PATHS = [
  '/etc/sing-box/config.json',
  '/usr/local/etc/sing-box/config.json',
];

const SING_BOX_CONF_DIRS = [
  '/etc/sing-box/conf',
  '/usr/local/etc/sing-box/conf',
];

const XRAY_CONFIG_PATHS = [
  '/etc/xray/config.json',
  '/usr/local/etc/xray/config.json',
];

const XRAY_CONF_DIRS = [
  '/etc/xray/conf',
  '/usr/local/etc/xray/conf',
];

const V2RAY_CONFIG_PATHS = [
  '/etc/v2ray/config.json',
  '/usr/local/etc/v2ray/config.json',
];

const V2RAY_CONF_DIRS = [
  '/etc/v2ray/conf',
  '/usr/local/etc/v2ray/conf',
];

export interface KernelRuntimeStatus {
  type: KernelType;
  detected: boolean;
  monitored: boolean;
  accessible: boolean;
  nodesCount: number;
  version?: string;
  configPaths: string[];
  binaryPath?: string;
  error?: string;
}

export interface KernelNodeSource {
  kernel: KernelType;
  url: string;
}

function findKernelBinary(type: KernelType): string | undefined {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      const candidate = path.join(dir, type);
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      const help = execFileSync(candidate, ['help'], {
        encoding: 'utf8',
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (help.includes('url [name]')) return candidate;
    } catch {
      // Continue searching the remaining PATH entries.
    }
  }
  return undefined;
}

export function discoverKernelConfigFiles(kernel: AgentKernelConfig): string[] {
  const files = new Set<string>();

  const addPath = (candidate: string) => {
    if (!fs.existsSync(candidate)) return;
    const stat = fs.statSync(candidate);
    if (stat.isFile()) {
      if (candidate.endsWith('.json')) files.add(candidate);
      return;
    }
    if (!stat.isDirectory()) return;
    for (const name of fs.readdirSync(candidate).sort()) {
      const file = path.join(candidate, name);
      if (name.endsWith('.json') && fs.statSync(file).isFile()) files.add(file);
    }
  };

  const pathGroups = kernel.type === 'xray'
    ? { files: XRAY_CONFIG_PATHS, dirs: XRAY_CONF_DIRS }
    : kernel.type === 'v2ray'
      ? { files: V2RAY_CONFIG_PATHS, dirs: V2RAY_CONF_DIRS }
      : { files: SING_BOX_CONFIG_PATHS, dirs: SING_BOX_CONF_DIRS };

  if (kernel.configPath && !pathGroups.files.includes(kernel.configPath)) {
    addPath(kernel.configPath);
  } else {
    for (const file of pathGroups.files) addPath(file);
    for (const dir of pathGroups.dirs) addPath(dir);
  }

  return Array.from(files);
}

function requestHost(req: IncomingRequest): string {
  const raw = req.headers.host;
  const host = Array.isArray(raw) ? raw[0] : raw;
  return (host || '').split(':')[0];
}

function publicKeyFromOutbounds(outbounds: any[] | undefined): string {
  for (const outbound of outbounds || []) {
    const tag = outbound?.tag || '';
    if (typeof tag === 'string' && tag.startsWith('public_key_')) {
      return tag.slice('public_key_'.length);
    }
  }
  return '';
}

function sourceName(tag: string, index: number, count: number): string {
  return encodeURIComponent(count > 1 ? `${tag}-${index + 1}` : tag);
}

function inboundToUrls(inbound: any, host: string, publicKey: string): string[] {
  const type = inbound?.type;
  const port = inbound?.listen_port;
  const tag = inbound?.tag || type;
  if (!host || !port) return [];
  const users = Array.isArray(inbound.users) ? inbound.users : [];

  if (type === 'vless') {
    return users.flatMap((user: any, index: number) => {
      const uuid = user?.uuid;
      if (!uuid) return [];
      const params = new URLSearchParams();
      params.set('type', 'tcp');
      if (inbound.tls?.enabled) {
        params.set('security', inbound.tls.reality?.enabled ? 'reality' : 'tls');
        params.set('sni', inbound.tls.server_name || inbound.tls.reality?.handshake?.server || host);
      }
      if (user.flow) params.set('flow', user.flow);
      if (publicKey) params.set('pbk', publicKey);
      const shortId = inbound.tls?.reality?.short_id?.[0];
      if (shortId) params.set('sid', shortId);
      return [`vless://${encodeURIComponent(uuid)}@${host}:${port}?${params.toString()}#${sourceName(tag, index, users.length)}`];
    });
  }

  if (type === 'trojan') {
    const params = new URLSearchParams();
    if (inbound.tls?.enabled) {
      params.set('security', 'tls');
      params.set('sni', inbound.tls.server_name || host);
    }
    return users.flatMap((user: any, index: number) => user?.password
      ? [`trojan://${encodeURIComponent(user.password)}@${host}:${port}?${params.toString()}#${sourceName(tag, index, users.length)}`]
      : []);
  }

  if (type === 'hysteria2') {
    const params = new URLSearchParams();
    params.set('sni', inbound.tls?.server_name || host);
    if (inbound.tls?.insecure) params.set('insecure', '1');
    if (inbound.obfs?.type) params.set('obfs', inbound.obfs.type);
    if (inbound.obfs?.password) params.set('obfs-password', inbound.obfs.password);
    return users.flatMap((user: any, index: number) => user?.password
      ? [`hysteria2://${encodeURIComponent(user.password)}@${host}:${port}?${params.toString()}#${sourceName(tag, index, users.length)}`]
      : []);
  }

  if (type === 'tuic') {
    return users.flatMap((user: any, index: number) => {
      if (!user?.uuid || !user?.password) return [];
      const params = new URLSearchParams();
      params.set('sni', inbound.tls?.server_name || host);
      if (inbound.tls?.insecure) params.set('allow_insecure', '1');
      return [`tuic://${encodeURIComponent(user.uuid)}:${encodeURIComponent(user.password)}@${host}:${port}?${params.toString()}#${sourceName(tag, index, users.length)}`];
    });
  }

  if (type === 'shadowsocks') {
    const method = inbound.method;
    const credentials = [
      ...(inbound.password ? [{ password: inbound.password }] : []),
      ...users.filter((user: any) => user?.password),
    ];
    if (!method) return [];
    return credentials.map((user: any, index: number) => {
      const userInfo = Buffer.from(`${method}:${user.password}`).toString('base64url');
      return `ss://${userInfo}@${host}:${port}#${sourceName(tag, index, credentials.length)}`;
    });
  }

  return [];
}

function xrayInboundToUrls(inbound: any, host: string): string[] {
  const protocol = inbound?.protocol;
  const port = inbound?.port;
  const tag = inbound?.tag || protocol;
  const clients = Array.isArray(inbound?.settings?.clients) ? inbound.settings.clients : [];
  if (!host || !port) return [];

  if (protocol === 'shadowsocks') {
    const method = inbound?.settings?.method;
    const password = inbound?.settings?.password;
    if (!method || !password) return [];
    const userInfo = Buffer.from(`${method}:${password}`).toString('base64url');
    return [`ss://${userInfo}@${host}:${port}#${encodeURIComponent(tag)}`];
  }

  if (clients.length === 0) return [];

  const stream = inbound.streamSettings || {};
  if (protocol === 'vless') {
    return clients.flatMap((client: any, index: number) => {
      if (!client?.id) return [];
      const params = new URLSearchParams();
      params.set('type', stream.network || 'tcp');
      if (stream.security && stream.security !== 'none') params.set('security', stream.security);
      const sni = stream.tlsSettings?.serverName || stream.realitySettings?.serverName || host;
      params.set('sni', sni);
      if (client.flow) params.set('flow', client.flow);
      if (stream.realitySettings?.publicKey) params.set('pbk', stream.realitySettings.publicKey);
      if (stream.realitySettings?.shortId) params.set('sid', stream.realitySettings.shortId);
      if (stream.wsSettings?.path) params.set('path', stream.wsSettings.path);
      return [`vless://${encodeURIComponent(client.id)}@${host}:${port}?${params.toString()}#${sourceName(tag, index, clients.length)}`];
    });
  }

  if (protocol === 'vmess') {
    return clients.flatMap((client: any, index: number) => {
      if (!client?.id) return [];
      const vmess = {
        v: '2', ps: clients.length > 1 ? `${tag}-${index + 1}` : tag, add: host,
        port: String(port), id: client.id, aid: String(client.alterId || 0),
        scy: client.security || 'auto', net: stream.network || 'tcp', type: 'none',
        host: stream.wsSettings?.headers?.Host || '', path: stream.wsSettings?.path || '/',
        tls: stream.security === 'tls' ? 'tls' : '',
      };
      return [`vmess://${Buffer.from(JSON.stringify(vmess)).toString('base64')}`];
    });
  }

  if (protocol === 'trojan') {
    const params = new URLSearchParams();
    const sni = stream.tlsSettings?.serverName || host;
    params.set('security', stream.security === 'reality' ? 'reality' : 'tls');
    params.set('sni', sni);
    if (stream.wsSettings?.path) params.set('path', stream.wsSettings.path);
    return clients.flatMap((client: any, index: number) => client?.password
      ? [`trojan://${encodeURIComponent(client.password)}@${host}:${port}?${params.toString()}#${sourceName(tag, index, clients.length)}`]
      : []);
  }

  return [];
}

function urlsFromWrapper(executable: string, file: string): string[] {
  const output = execFileSync(executable, ['url', file], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).replace(/\u001b\[[0-9;]*m/g, '');
  return output.split(/\r?\n/).map(line => line.trim()).filter(line =>
    /^(?:vless|vmess|ss|ssr|trojan|hysteria2|hy2|tuic|wireguard):\/\//.test(line));
}

function extractKernelNodeUrls(kernel: AgentKernelConfig, configPaths: string[], host: string, executable?: string): {
  urls: string[];
  readableFiles: number;
  errors: string[];
} {
  const urls: string[] = [];
  const errors: string[] = [];
  let readableFiles = 0;
  for (const file of configPaths) {
    try {
      if (executable) {
        try {
          const generated = urlsFromWrapper(executable, file);
          if (generated.length > 0) {
            urls.push(...generated);
            readableFiles += 1;
            continue;
          }
        } catch { /* Fall back to the structured parser for older wrappers. */ }
      }
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const publicKey = publicKeyFromOutbounds(parsed.outbounds);
      for (const inbound of parsed.inbounds || []) {
        const inboundUrls = kernel.type === 'sing-box'
          ? inboundToUrls(inbound, host, publicKey)
          : xrayInboundToUrls(inbound, host);
        urls.push(...inboundUrls);
      }
      readableFiles += 1;
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { urls: Array.from(new Set(urls)), readableFiles, errors };
}

export function collectKernelSources(config: AgentConfig, host: string): {
  sources: KernelNodeSource[];
  kernels: KernelRuntimeStatus[];
} {
  const sources: KernelNodeSource[] = [];
  const kernels: KernelRuntimeStatus[] = [];
  const seenUrls = new Set<string>();

  for (const type of SUPPORTED_KERNELS) {
    const kernel = config.kernels.find(item => item.type === type);
    const binaryPath = findKernelBinary(type);
    const status: KernelRuntimeStatus = {
      type,
      detected: Boolean(binaryPath),
      monitored: Boolean(kernel),
      accessible: false,
      nodesCount: 0,
      configPaths: [],
      ...(binaryPath ? { binaryPath } : {}),
    };

    if (!kernel) {
      kernels.push(status);
      continue;
    }

    try {
      status.configPaths = discoverKernelConfigFiles(kernel);
      if (status.configPaths.length > 0) {
        const extracted = extractKernelNodeUrls(kernel, status.configPaths, host, binaryPath);
        for (const url of extracted.urls) {
          if (seenUrls.has(url)) continue;
          seenUrls.add(url);
          sources.push({ kernel: type, url });
          status.nodesCount += 1;
        }
        status.accessible = extracted.readableFiles > 0;
        if (extracted.errors.length > 0) status.error = extracted.errors.join('; ');
      }
    } catch (error) {
      status.error = error instanceof Error ? error.message : String(error);
    }

    kernels.push(status);
  }

  return { sources, kernels };
}

export function handleUrls(req: IncomingRequest, config: AgentConfig): Response {
  if (config.node.secret) {
    const { valid, error } = hmacVerify(req, config.node.secret);
    if (!valid) {
      return new Response(
        JSON.stringify({ success: false, error: `认证失败: ${error}`, timestamp: new Date().toISOString() }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  const data = collectKernelSources(config, requestHost(req));
  return new Response(
    JSON.stringify({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
