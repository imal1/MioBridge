import type { KernelType } from '../kernels/types.js';
import { proxyUrlProtocol } from '../nodes/nodeProxy.js';
import type { NodeProxyConfig } from '../nodes/types.js';

export interface CollectedProxySource {
  url: string; kernel: KernelType; nodeId: string; location: string;
  /** 来源所属节点的订阅出口设置；由收集方附带，生成产物时统一应用。 */
  proxy?: NodeProxyConfig;
}
export interface ClashSubscriptionResult { content: string; errors: string[] }
interface NamedSource { source: CollectedProxySource; baseName: string; protocol: string; vmess?: Record<string, unknown> }

export function dedupeProxySources(sources: readonly CollectedProxySource[]): CollectedProxySource[] {
  const unique = new Map<string, CollectedProxySource>();
  for (const source of sources) if (!unique.has(source.url)) unique.set(source.url, source);
  return [...unique.values()];
}

function fragment(url: string): string {
  const index = url.indexOf('#');
  if (index < 0) return '';
  try { return decodeURIComponent(url.slice(index + 1)); } catch { return url.slice(index + 1); }
}

function readSource(source: CollectedProxySource): NamedSource {
  // 配置了显示名称的节点已由 applyNodeDisplayNames 写入最终名称，不再叠加地域前缀。
  const prefix = source.proxy?.displayName ? '' : source.location;
  if (source.url.startsWith('vmess://')) {
    const vmess = JSON.parse(Buffer.from(source.url.slice(8), 'base64').toString('utf8')) as Record<string, unknown>;
    const original = typeof vmess.ps === 'string' ? vmess.ps : '';
    return { source, baseName: [prefix, original].filter(Boolean).join(' '), protocol: 'vmess', vmess };
  }
  const protocol = source.url.slice(0, source.url.indexOf('://'));
  return { source, baseName: [prefix, fragment(source.url)].filter(Boolean).join(' '), protocol };
}

function rewrite(named: NamedSource, name: string): string {
  if (named.protocol === 'vmess' && named.vmess) {
    return `vmess://${Buffer.from(JSON.stringify({ ...named.vmess, ps: name })).toString('base64')}`;
  }
  const index = named.source.url.indexOf('#');
  return `${index < 0 ? named.source.url : named.source.url.slice(0, index)}#${encodeURIComponent(name)}`;
}

const PROTOCOL_LABELS: Readonly<Record<string, string>> = {
  vless: 'VLESS', vmess: 'VMess', trojan: 'Trojan', hysteria2: 'Hysteria2', tuic: 'TUIC',
  ss: 'Shadowsocks', ssr: 'SSR', wireguard: 'WireGuard',
};

/**
 * Renames the sources of nodes that carry an explicit `proxy.displayName` to
 * "<displayName> <protocol>" (numbered when a protocol repeats). The name is
 * written into the share link itself, so raw/Base64 output, the Clash proxy
 * list and the generated policy-group references all agree on it.
 */
export function applyNodeDisplayNames(sources: readonly CollectedProxySource[]): CollectedProxySource[] {
  const counts = new Map<string, number>();
  return sources.map(source => {
    const displayName = source.proxy?.displayName;
    if (!displayName) return source;
    try {
      const named = readSource(source);
      const protocol = proxyUrlProtocol(source.url);
      const base = `${displayName} ${PROTOCOL_LABELS[protocol] ?? protocol}`;
      const seen = (counts.get(base) ?? 0) + 1;
      counts.set(base, seen);
      return { ...source, url: rewrite(named, seen > 1 ? `${base} ${seen}` : base) };
    } catch { return source; /* Clash 命名阶段会把不可解析的来源报告为警告。 */ }
  });
}

function render(named: NamedSource[]): string {
  const used = new Set<string>();
  return named.map(item => {
    const base = item.baseName || `${item.source.location || '代理节点'} ${item.protocol}`;
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base} ${suffix++}`;
    used.add(name);
    return rewrite(item, name);
  }).join('\n');
}

export function buildClashSubscription(sources: readonly CollectedProxySource[]): string {
  return render(dedupeProxySources(sources).map(readSource));
}

export function buildClashSubscriptionResult(sources: readonly CollectedProxySource[]): ClashSubscriptionResult {
  const named: NamedSource[] = [];
  const errors: string[] = [];
  for (const source of dedupeProxySources(sources)) {
    try { named.push(readSource(source)); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`节点 ${source.nodeId} 内核 ${source.kernel} 的 Clash 来源命名失败: ${message}`);
    }
  }
  return { content: render(named), errors };
}
