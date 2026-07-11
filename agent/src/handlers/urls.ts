import {
  SUPPORTED_KERNELS,
  type AgentConfig,
  type AgentKernelConfig,
  type KernelType,
} from '../config';
import * as fs from 'fs';
import * as path from 'path';
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
  error?: string;
}

export interface KernelNodeSource {
  kernel: KernelType;
  url: string;
}

function isKernelBinaryDetected(type: KernelType): boolean {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      const candidate = path.join(dir, type);
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      // Continue searching the remaining PATH entries.
    }
  }
  return false;
}

export function discoverKernelConfigFiles(kernel: AgentKernelConfig): string[] {
  const files = new Set<string>();
  if (kernel.configPath) files.add(kernel.configPath);

  const pathGroups = kernel.type === 'xray'
    ? { files: XRAY_CONFIG_PATHS, dirs: XRAY_CONF_DIRS }
    : kernel.type === 'v2ray'
      ? { files: V2RAY_CONFIG_PATHS, dirs: V2RAY_CONF_DIRS }
      : { files: SING_BOX_CONFIG_PATHS, dirs: SING_BOX_CONF_DIRS };

  for (const file of pathGroups.files) files.add(file);
  for (const dir of pathGroups.dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith('.json')) files.add(path.join(dir, name));
      }
  }

  return Array.from(files).filter(file => fs.existsSync(file));
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

function inboundToUrl(inbound: any, host: string, publicKey: string): string | null {
  const type = inbound?.type;
  const port = inbound?.listen_port;
  const tag = inbound?.tag || type;
  if (!host || !port) return null;

  if (type === 'vless') {
    const user = inbound.users?.[0];
    const uuid = user?.uuid;
    if (!uuid) return null;

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
    return `vless://${uuid}@${host}:${port}?${params.toString()}#${encodeURIComponent(tag)}`;
  }

  if (type === 'trojan') {
    const password = inbound.users?.[0]?.password;
    if (!password) return null;
    const params = new URLSearchParams();
    if (inbound.tls?.enabled) {
      params.set('security', 'tls');
      params.set('sni', inbound.tls.server_name || host);
    }
    return `trojan://${password}@${host}:${port}?${params.toString()}#${encodeURIComponent(tag)}`;
  }

  return null;
}

function xrayInboundToUrl(inbound: any, host: string): string | null {
  const protocol = inbound?.protocol;
  const port = inbound?.port;
  const tag = inbound?.tag || protocol;
  const client = inbound?.settings?.clients?.[0];
  if (!host || !port || !client) return null;

  const stream = inbound.streamSettings || {};
  if (protocol === 'vless') {
    const params = new URLSearchParams();
    params.set('type', stream.network || 'tcp');
    if (stream.security && stream.security !== 'none') params.set('security', stream.security);
    const sni = stream.tlsSettings?.serverName || stream.realitySettings?.serverName || host;
    params.set('sni', sni);
    if (client.flow) params.set('flow', client.flow);
    if (stream.realitySettings?.publicKey) params.set('pbk', stream.realitySettings.publicKey);
    if (stream.realitySettings?.shortId) params.set('sid', stream.realitySettings.shortId);
    if (stream.wsSettings?.path) params.set('path', stream.wsSettings.path);
    return `vless://${client.id}@${host}:${port}?${params.toString()}#${encodeURIComponent(tag)}`;
  }

  if (protocol === 'vmess') {
    const vmess = {
      v: '2',
      ps: tag,
      add: host,
      port: String(port),
      id: client.id,
      aid: String(client.alterId || 0),
      scy: client.security || 'auto',
      net: stream.network || 'tcp',
      type: 'none',
      host: stream.wsSettings?.headers?.Host || '',
      path: stream.wsSettings?.path || '/',
      tls: stream.security === 'tls' ? 'tls' : '',
    };
    return `vmess://${Buffer.from(JSON.stringify(vmess)).toString('base64')}`;
  }

  if (protocol === 'trojan') {
    const params = new URLSearchParams();
    const sni = stream.tlsSettings?.serverName || host;
    params.set('security', stream.security === 'reality' ? 'reality' : 'tls');
    params.set('sni', sni);
    if (stream.wsSettings?.path) params.set('path', stream.wsSettings.path);
    return `trojan://${client.password}@${host}:${port}?${params.toString()}#${encodeURIComponent(tag)}`;
  }

  return null;
}

function extractKernelNodeUrls(kernel: AgentKernelConfig, configPaths: string[], host: string): string[] {
  const urls: string[] = [];
  for (const file of configPaths) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const publicKey = publicKeyFromOutbounds(parsed.outbounds);
    for (const inbound of parsed.inbounds || []) {
      const url = kernel.type === 'sing-box'
        ? inboundToUrl(inbound, host, publicKey)
        : xrayInboundToUrl(inbound, host);
      if (url) urls.push(url);
    }
  }
  return Array.from(new Set(urls));
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
    const status: KernelRuntimeStatus = {
      type,
      detected: isKernelBinaryDetected(type),
      monitored: Boolean(kernel),
      accessible: false,
      nodesCount: 0,
      configPaths: [],
    };

    if (!kernel) {
      kernels.push(status);
      continue;
    }

    try {
      status.configPaths = discoverKernelConfigFiles(kernel);
      if (status.configPaths.length > 0) {
        const urls = extractKernelNodeUrls(kernel, status.configPaths, host);
        for (const url of urls) {
          if (seenUrls.has(url)) continue;
          seenUrls.add(url);
          sources.push({ kernel: type, url });
          status.nodesCount += 1;
        }
        status.accessible = true;
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
