import { describe, expect, it } from 'vitest';
import { V2rayAdapter, XrayAdapter, type KernelFileSystem } from '../../src/index.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function fsWith(path: string, content?: string): KernelFileSystem {
  const files = new Map<string, string>();
  if (content !== undefined) files.set(path, content);
  return {
    async exists(p: string) { return files.has(p); },
    async mkdir() {},
    async readFile(p: string) { return files.get(p) ?? ''; },
    async writeFile(p: string, c: string) { files.set(p, c); },
    async remove(p: string) { files.delete(p); },
  };
}

function outbounds(...items: unknown[]) { return JSON.stringify({ outbounds: items }); }

describe('json outbound adapters', () => {
  it('reports availability and default config path per kernel', async () => {
    const xray = new XrayAdapter(fsWith('/etc/xray/config.json', outbounds()), logger);
    const v2ray = new V2rayAdapter(fsWith('/etc/v2ray/config.json', outbounds()), logger);
    expect(await xray.getConfigPaths()).toEqual(['/etc/xray/config.json']);
    expect(await v2ray.getConfigPaths()).toEqual(['/etc/v2ray/config.json']);
    expect(await xray.isAvailable()).toBe(true);
    expect(await new XrayAdapter(fsWith('/etc/xray/config.json'), logger).isAvailable()).toBe(false);
  });

  it('returns empty when config missing and swallows parse errors', async () => {
    expect(await new XrayAdapter(fsWith('/etc/xray/config.json'), logger).extractNodeUrls()).toEqual([]);
    expect(await new XrayAdapter(fsWith('/etc/xray/config.json', 'not-json'), logger).extractNodeUrls()).toEqual([]);
    expect(await new XrayAdapter(fsWith('/etc/xray/config.json', outbounds()), logger).extractNodeUrls()).toEqual([]);
  });

  it('encodes vmess outbounds as base64 payloads', async () => {
    const adapter = new XrayAdapter(fsWith('/etc/xray/config.json', outbounds({
      protocol: 'vmess', tag: 'hk',
      settings: { vnext: [{ address: '1.2.3.4', port: 443, users: [{ id: 'uuid', alterId: 2, security: 'aes-128-gcm' }] }] },
      streamSettings: { network: 'ws', security: 'tls', wsSettings: { path: '/ray' } },
    })), logger);
    const [url] = await adapter.extractNodeUrls();
    expect(url).toMatch(/^vmess:\/\//);
    const body = JSON.parse(Buffer.from(url!.slice(8), 'base64').toString('utf8'));
    expect(body).toMatchObject({ ps: 'hk', add: '1.2.3.4', port: '443', id: 'uuid', aid: '2', scy: 'aes-128-gcm', net: 'ws', path: '/ray', tls: 'tls' });
  });

  it('builds vless urls with reality and flow params', async () => {
    const adapter = new XrayAdapter(fsWith('/etc/xray/config.json', outbounds({
      protocol: 'vless', tag: '香港 节点',
      settings: { vnext: [{ address: 'host', port: 8443, users: [{ id: 'uid', flow: 'xtls-rprx-vision' }] }] },
      streamSettings: { network: 'tcp', security: 'reality', realitySettings: { serverName: 'sni.example', publicKey: 'pbk', shortId: 'sid' } },
    })), logger);
    const [url] = await adapter.extractNodeUrls();
    expect(url).toContain('vless://uid@host:8443?');
    expect(url).toContain('security=reality');
    expect(url).toContain('flow=xtls-rprx-vision');
    expect(url).toContain('pbk=pbk');
    expect(url).toContain('sid=sid');
    expect(url).toContain(`#${encodeURIComponent('香港 节点')}`);
  });

  it('emits trojan and shadowsocks urls from server settings', async () => {
    const adapter = new XrayAdapter(fsWith('/etc/xray/config.json', outbounds(
      { protocol: 'trojan', tag: 't', settings: { servers: [{ address: 'srv', port: 443, password: 'pw' }] }, streamSettings: { network: 'ws' } },
      { protocol: 'shadowsocks', tag: 's', settings: { servers: [{ address: 'ss', port: 8388, method: 'chacha20', password: 'pw2' }] } },
    )), logger);
    const [trojan, ss] = await adapter.extractNodeUrls();
    expect(trojan).toContain('trojan://pw@srv:443?');
    expect(trojan).toContain('type=ws');
    expect(ss).toMatch(/^ss:\/\//);
    expect(Buffer.from(ss!.slice(5, ss!.indexOf('@')), 'base64').toString('utf8')).toBe('chacha20:pw2');
  });

  it('drops unsupported or incomplete outbounds', async () => {
    const adapter = new XrayAdapter(fsWith('/etc/xray/config.json', outbounds(
      { protocol: 'wireguard' },
      { protocol: 'vmess' },
      { protocol: 'vless', settings: { vnext: [{ address: 'a', port: 1 }] } },
    )), logger);
    const urls = await adapter.extractNodeUrls();
    expect(urls).toEqual(['vless://@a:1?type=tcp&sni=a#vless']);
  });
});
