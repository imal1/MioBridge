import type { KernelType } from '../types';

export interface CollectedProxySource {
  url: string;
  kernel: KernelType;
  nodeId: string;
  location: string;
}

export interface ClashSubscriptionResult {
  content: string;
  errors: string[];
}

interface NamedSource {
  source: CollectedProxySource;
  originalName: string;
  baseName: string;
  protocol: string;
  vmessConfig?: Record<string, unknown>;
}

export function dedupeProxySources(sources: CollectedProxySource[]): CollectedProxySource[] {
  const byUrl = new Map<string, CollectedProxySource>();
  for (const source of sources) {
    if (!byUrl.has(source.url)) byUrl.set(source.url, source);
  }
  return Array.from(byUrl.values());
}

function decodeFragmentName(url: string): string {
  const hashIndex = url.indexOf('#');
  if (hashIndex === -1) return '';
  try {
    return decodeURIComponent(url.slice(hashIndex + 1));
  } catch {
    return url.slice(hashIndex + 1);
  }
}

function readNamedSource(source: CollectedProxySource): NamedSource {
  if (source.url.startsWith('vmess://')) {
    const encoded = source.url.slice('vmess://'.length);
    const config = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Record<string, unknown>;
    const originalName = typeof config.ps === 'string' ? config.ps : '';
    return {
      source,
      originalName,
      baseName: [source.location, originalName].filter(Boolean).join(' '),
      protocol: 'vmess',
      vmessConfig: config,
    };
  }

  const protocol = source.url.slice(0, source.url.indexOf('://'));
  const originalName = decodeFragmentName(source.url);
  return {
    source,
    originalName,
    baseName: [source.location, originalName].filter(Boolean).join(' '),
    protocol,
  };
}

function rewriteName(named: NamedSource, name: string): string {
  if (named.protocol === 'vmess' && named.vmessConfig) {
    const rewritten = { ...named.vmessConfig, ps: name };
    return `vmess://${Buffer.from(JSON.stringify(rewritten)).toString('base64')}`;
  }

  const hashIndex = named.source.url.indexOf('#');
  const withoutFragment = hashIndex === -1
    ? named.source.url
    : named.source.url.slice(0, hashIndex);
  return `${withoutFragment}#${encodeURIComponent(name)}`;
}

/**
 * Strict convenience API for callers that require every source to be valid.
 * Throws when any source cannot be named; production aggregation should use
 * buildClashSubscriptionResult() so one malformed source does not abort others.
 */
export function buildClashSubscription(sources: CollectedProxySource[]): string {
  const namedSources = dedupeProxySources(sources).map(readNamedSource);
  return buildNamedSubscription(namedSources).join('\n');
}

function finalName(named: NamedSource, nameCounts: Map<string, number>): string {
  return nameCounts.get(named.baseName)! > 1
    ? `${named.baseName} [${named.source.url}]`
    : named.baseName;
}

function buildNamedSubscription(namedSources: NamedSource[]): string[] {
  const nameCounts = new Map<string, number>();
  for (const named of namedSources) {
    nameCounts.set(named.baseName, (nameCounts.get(named.baseName) ?? 0) + 1);
  }

  return namedSources.map(named => rewriteName(named, finalName(named, nameCounts)));
}

function sourceError(source: CollectedProxySource, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `节点 ${source.nodeId} 内核 ${source.kernel} 的 Clash 来源命名失败: ${message}`;
}

export function buildClashSubscriptionResult(sources: CollectedProxySource[]): ClashSubscriptionResult {
  const errors: string[] = [];
  const namedSources: NamedSource[] = [];
  for (const source of dedupeProxySources(sources)) {
    try {
      namedSources.push(readNamedSource(source));
    } catch (error) {
      errors.push(sourceError(source, error));
    }
  }

  const nameCounts = new Map<string, number>();
  for (const named of namedSources) {
    nameCounts.set(named.baseName, (nameCounts.get(named.baseName) ?? 0) + 1);
  }

  const rewritten: string[] = [];
  for (const named of namedSources) {
    try {
      rewritten.push(rewriteName(named, finalName(named, nameCounts)));
    } catch (error) {
      errors.push(sourceError(named.source, error));
    }
  }
  return { content: rewritten.join('\n'), errors };
}
