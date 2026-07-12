import type { KernelType } from '../kernels/types.js';

export interface CollectedProxySource { url: string; kernel: KernelType; nodeId: string; location: string }
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
  if (source.url.startsWith('vmess://')) {
    const vmess = JSON.parse(Buffer.from(source.url.slice(8), 'base64').toString('utf8')) as Record<string, unknown>;
    const original = typeof vmess.ps === 'string' ? vmess.ps : '';
    return { source, baseName: [source.location, original].filter(Boolean).join(' '), protocol: 'vmess', vmess };
  }
  const protocol = source.url.slice(0, source.url.indexOf('://'));
  return { source, baseName: [source.location, fragment(source.url)].filter(Boolean).join(' '), protocol };
}

function rewrite(named: NamedSource, name: string): string {
  if (named.protocol === 'vmess' && named.vmess) {
    return `vmess://${Buffer.from(JSON.stringify({ ...named.vmess, ps: name })).toString('base64')}`;
  }
  const index = named.source.url.indexOf('#');
  return `${index < 0 ? named.source.url : named.source.url.slice(0, index)}#${encodeURIComponent(name)}`;
}

function render(named: NamedSource[]): string {
  const counts = new Map<string, number>();
  for (const item of named) counts.set(item.baseName, (counts.get(item.baseName) ?? 0) + 1);
  return named.map(item => rewrite(item, counts.get(item.baseName)! > 1 ? `${item.baseName} [${item.source.url}]` : item.baseName)).join('\n');
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
