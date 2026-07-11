import { describe, expect, it } from 'vitest';
import type { KernelType } from '../../types';
import {
  buildClashSubscription,
  buildClashSubscriptionResult,
  dedupeProxySources,
  type CollectedProxySource,
} from '../proxySources';

function source(
  url: string,
  location: string,
  kernel: KernelType = 'sing-box',
  nodeId = 'node-a',
): CollectedProxySource {
  return { url, kernel, nodeId, location };
}

describe('proxy source normalization', () => {
  it.each([
    ['vless://id@a.example:443#reality', 'vless://id@a.example:443#%E9%A6%99%E6%B8%AF%20reality'],
    ['trojan://secret@a.example:443#trojan-node', 'trojan://secret@a.example:443#%E9%A6%99%E6%B8%AF%20trojan-node'],
    ['ss://YWVzLTEyOC1nY206cGFzcw==@a.example:443#ss-node', 'ss://YWVzLTEyOC1nY206cGFzcw==@a.example:443#%E9%A6%99%E6%B8%AF%20ss-node'],
  ])('prefixes the decoded %s fragment with its region', (url, expected) => {
    expect(buildClashSubscription([source(url, '香港')])).toBe(expected);
  });

  it('uses the full original URL to disambiguate equal regional names without numeric suffixes', () => {
    const collision = buildClashSubscription([
      source('vless://id-a@a.example:443#node', '香港'),
      source('vless://id-b@b.example:443#node', '香港'),
    ]);

    expect(decodeURIComponent(collision)).toContain('香港 node [vless://id-a@a.example:443#node]');
    expect(decodeURIComponent(collision)).toContain('香港 node [vless://id-b@b.example:443#node]');
    expect(decodeURIComponent(collision)).not.toMatch(/node \d+$/m);
  });

  it('removes identical full URLs globally while retaining the first provenance record', () => {
    const duplicate = 'vless://id@a.example:443#same';
    const sources = [
      source(duplicate, '香港', 'sing-box', 'first'),
      source(duplicate, '新加坡', 'xray', 'second'),
    ];

    expect(dedupeProxySources(sources)).toEqual([sources[0]]);
    expect(buildClashSubscription(sources).split('\n')).toHaveLength(1);
    expect(decodeURIComponent(buildClashSubscription(sources))).toContain('香港 same');
  });

  it('rewrites only VMess ps while preserving every other decoded JSON field', () => {
    const original = {
      v: '2', ps: 'vmess-node', add: 'vmess.example', port: '443', id: 'uuid',
      aid: '0', scy: 'auto', net: 'ws', type: 'none', host: 'cdn.example',
      path: '/ws?ed=2048', tls: 'tls', sni: 'sni.example', alpn: 'h2,http/1.1', fp: 'chrome',
    };
    const url = `vmess://${Buffer.from(JSON.stringify(original)).toString('base64')}`;

    const rewritten = buildClashSubscription([source(url, '日本')]);
    const decoded = JSON.parse(Buffer.from(rewritten.slice('vmess://'.length), 'base64').toString('utf8'));

    expect(decoded.ps).toBe('日本 vmess-node');
    const { ps: _originalPs, ...originalRest } = original;
    const { ps: _rewrittenPs, ...rewrittenRest } = decoded;
    expect(rewrittenRest).toEqual(originalRest);
  });

  it('disambiguates colliding VMess names with the complete original URLs', () => {
    const vmess = (add: string) => {
      const payload = { v: '2', ps: 'node', add, port: '443', id: add, aid: '0', net: 'tcp' };
      return `vmess://${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
    };
    const first = vmess('a.example');
    const second = vmess('b.example');
    const rewritten = buildClashSubscription([
      source(first, '美国'),
      source(second, '美国'),
    ]).split('\n').map(line => JSON.parse(Buffer.from(line.slice(8), 'base64').toString('utf8')));

    expect(rewritten.map(item => item.ps)).toEqual([
      `美国 node [${first}]`,
      `美国 node [${second}]`,
    ]);
  });

  it('uses location only when the original fragment is empty', () => {
    expect(buildClashSubscription([
      source('vless://id@a.example:443#', '香港'),
    ])).toBe('vless://id@a.example:443#%E9%A6%99%E6%B8%AF');
  });

  it.each([
    ['vless://id@a.example:443#part#two', '香港 part#two'],
    ['vless://id@a.example:443#bad%name', '香港 bad%name'],
    ['vless://id@a.example:443#line%0Abreak', '香港 line\nbreak'],
  ])('rewrites unusual fragments without changing non-fragment URL data: %s', (url, expectedName) => {
    const rewritten = buildClashSubscription([source(url, '香港')]);
    expect(rewritten.slice(0, rewritten.indexOf('#'))).toBe(url.slice(0, url.indexOf('#')));
    expect(decodeURIComponent(rewritten.slice(rewritten.indexOf('#') + 1))).toBe(expectedName);
  });

  it('isolates malformed VMess and reports its provenance while retaining valid Clash input', () => {
    const result = buildClashSubscriptionResult([
      source('vmess://not-json', '香港', 'xray', 'broken-node'),
      source('trojan://secret@ok.example:443#usable', '日本', 'sing-box', 'ok-node'),
    ]);

    expect(result.content).toBe('trojan://secret@ok.example:443#%E6%97%A5%E6%9C%AC%20usable');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('broken-node');
    expect(result.errors[0]).toContain('xray');
  });
});
