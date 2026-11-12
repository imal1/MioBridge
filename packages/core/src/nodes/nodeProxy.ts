import { isIP } from 'node:net';
import { NODE_PROXY_PROTOCOLS, type NodeProxyConfig, type NodeProxyProtocol } from './types.js';

const PROXY_FIELDS = ['server', 'sni', 'certVerify', 'protocols', 'displayName'] as const;
const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
/** 分享链接里表达「跳过证书校验」的各种拼写；改写策略时必须一并清掉，否则残留的拼写会让客户端继续跳过。 */
const INSECURE_KEYS = new Set(['insecure', 'allowinsecure', 'allow_insecure', 'skip-cert-verify']);

function text(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`节点出口设置 ${field} 必须是字符串`);
  return value.trim() || undefined;
}

/**
 * Validates persisted/API input for a node's subscription endpoint settings.
 * Empty strings mean "not set"; an object with nothing set normalizes to undefined
 * so nodes.yaml never carries an empty `proxy` block.
 */
export function validateNodeProxy(value: unknown): NodeProxyConfig | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('节点出口设置无效');
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).find(key => !PROXY_FIELDS.includes(key as typeof PROXY_FIELDS[number]));
  if (unknown) throw new Error(`节点出口设置包含未知字段: ${unknown}`);

  const rawServer = text(input.server, 'server');
  const server = rawServer?.replace(/^\[(.*)\]$/, '$1');
  if (server && !HOSTNAME.test(server) && isIP(server) === 0) throw new Error('连接域名必须是有效的域名或 IP 地址');
  const sni = text(input.sni, 'sni');
  if (sni && !HOSTNAME.test(sni)) throw new Error('TLS SNI 必须是有效的域名');
  const certVerify = text(input.certVerify, 'certVerify');
  if (certVerify && certVerify !== 'strict' && certVerify !== 'insecure') throw new Error('证书校验策略只能是 strict 或 insecure');
  const displayName = text(input.displayName, 'displayName');
  if (displayName && (displayName.length > 64 || /[\u0000-\u001f\u007f]/.test(displayName))) throw new Error('订阅显示名称必须是 1 到 64 个可见字符');

  let protocols: NodeProxyProtocol[] | undefined;
  if (input.protocols !== undefined && input.protocols !== null) {
    if (!Array.isArray(input.protocols)) throw new Error('节点出口设置 protocols 必须是数组');
    const selected = input.protocols.map(item => {
      const protocol = item === 'hy2' ? 'hysteria2' : item;
      if (typeof protocol !== 'string' || !NODE_PROXY_PROTOCOLS.includes(protocol as NodeProxyProtocol)) throw new Error(`不支持的出口协议: ${String(item)}`);
      return protocol as NodeProxyProtocol;
    });
    // Canonical order keeps nodes.yaml stable regardless of how the UI ordered the chips.
    const ordered = NODE_PROXY_PROTOCOLS.filter(protocol => selected.includes(protocol));
    if (ordered.length) protocols = ordered;
  }

  const proxy: NodeProxyConfig = {
    ...(server ? { server } : {}),
    ...(sni ? { sni } : {}),
    ...(certVerify ? { certVerify: certVerify as NonNullable<NodeProxyConfig['certVerify']> } : {}),
    ...(protocols ? { protocols } : {}),
    ...(displayName ? { displayName } : {}),
  };
  return Object.keys(proxy).length ? proxy : undefined;
}

/** Share-link scheme of a proxy URL, with the `hy2` alias folded into `hysteria2`. */
export function proxyUrlProtocol(url: string): string {
  const scheme = url.slice(0, Math.max(0, url.indexOf('://'))).toLowerCase();
  return scheme === 'hy2' ? 'hysteria2' : scheme;
}

function decodeKey(part: string): string {
  const key = part.split('=')[0] ?? '';
  try { return decodeURIComponent(key).toLowerCase(); } catch { return key.toLowerCase(); }
}

function queryValue(parts: readonly string[], name: string): string | undefined {
  const part = parts.find(item => decodeKey(item) === name);
  if (part === undefined) return undefined;
  const value = part.slice(part.indexOf('=') + 1);
  try { return decodeURIComponent(value); } catch { return value; }
}

function rewriteVmess(url: string, proxy: NodeProxyConfig): string {
  const vmess = JSON.parse(Buffer.from(url.slice(8), 'base64').toString('utf8')) as Record<string, unknown>;
  if (!vmess || typeof vmess !== 'object' || Array.isArray(vmess)) return url;
  const next: Record<string, unknown> = { ...vmess };
  if (proxy.server) next.add = proxy.server;
  if (vmess.tls === 'tls') {
    if (proxy.sni) next.sni = proxy.sni;
    if (proxy.certVerify) {
      // vmess 分享 JSON 没有统一的校验字段，同时写入两种常见拼写。
      const flag = proxy.certVerify === 'insecure' ? '1' : '0';
      next.insecure = flag; next.allowInsecure = flag;
    }
  }
  if (JSON.stringify(next) === JSON.stringify(vmess)) return url;
  return `vmess://${Buffer.from(JSON.stringify(next)).toString('base64')}`;
}

/**
 * Applies a node's explicit endpoint settings to one share link. Only the host,
 * SNI and certificate-verification markers are touched; credentials, port and
 * every other parameter keep their original bytes. Reality and plaintext
 * protocols never receive SNI or verification changes because neither is a
 * certificate-validated TLS session.
 */
export function applyNodeProxy(url: string, proxy: NodeProxyConfig | undefined): string {
  if (!proxy || (!proxy.server && !proxy.sni && !proxy.certVerify)) return url;
  const protocol = proxyUrlProtocol(url);
  if (!NODE_PROXY_PROTOCOLS.includes(protocol as NodeProxyProtocol)) return url;
  if (proxy.protocols && !proxy.protocols.includes(protocol as NodeProxyProtocol)) return url;
  try {
    if (protocol === 'vmess') return rewriteVmess(url, proxy);

    const schemeEnd = url.indexOf('://') + 3;
    const hashIndex = url.indexOf('#', schemeEnd);
    const hash = hashIndex < 0 ? '' : url.slice(hashIndex);
    const body = url.slice(schemeEnd, hashIndex < 0 ? undefined : hashIndex);
    const queryIndex = body.indexOf('?');
    const location = queryIndex < 0 ? body : body.slice(0, queryIndex);
    const pathIndex = location.indexOf('/');
    const authority = pathIndex < 0 ? location : location.slice(0, pathIndex);
    const path = pathIndex < 0 ? '' : location.slice(pathIndex);
    const at = authority.lastIndexOf('@');
    if (at < 0) return url;
    const hostPort = authority.slice(at + 1);
    const portIndex = hostPort.startsWith('[') ? hostPort.indexOf(']') + 1 : hostPort.lastIndexOf(':');
    const port = portIndex <= 0 ? '' : hostPort.slice(portIndex);
    const host = proxy.server
      ? (isIP(proxy.server) === 6 ? `[${proxy.server}]` : proxy.server)
      : portIndex <= 0 ? hostPort : hostPort.slice(0, portIndex);

    let parts = queryIndex < 0 ? [] : body.slice(queryIndex + 1).split('&').filter(Boolean);
    const security = queryValue(parts, 'security')?.toLowerCase();
    const certificateTls = protocol === 'hysteria2' || protocol === 'tuic'
      || (protocol === 'trojan' && security !== 'reality' && security !== 'none')
      || (protocol === 'vless' && (security === 'tls' || security === 'xtls'));
    if (certificateTls && proxy.sni) {
      const encoded = `sni=${encodeURIComponent(proxy.sni)}`;
      const index = parts.findIndex(part => decodeKey(part) === 'sni');
      if (index >= 0) parts[index] = encoded;
      // `peer` is a legacy alias for SNI; leaving it behind would contradict the explicit value.
      parts = parts.filter((part, position) => position === index || !['sni', 'peer'].includes(decodeKey(part)));
      if (index < 0) parts.push(encoded);
    }
    if (certificateTls && proxy.certVerify) {
      parts = parts.filter(part => !INSECURE_KEYS.has(decodeKey(part)));
      if (proxy.certVerify === 'insecure') {
        if (protocol === 'tuic') parts.push('allow_insecure=1');
        else if (protocol !== 'hysteria2') parts.push('allowInsecure=1');
        parts.push('insecure=1');
      }
    }
    const query = parts.length ? `?${parts.join('&')}` : '';
    const rewritten = `${url.slice(0, schemeEnd)}${authority.slice(0, at + 1)}${host}${port}${path}${query}${hash}`;
    // A bare trailing `?` is the only difference an untouched link can show; keep its original bytes.
    return rewritten === url.replace(/\?(?=#|$)/, '') ? url : rewritten;
  } catch { return url; }
}
