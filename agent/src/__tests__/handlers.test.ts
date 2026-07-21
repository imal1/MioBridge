import { afterEach, describe, it, expect } from 'bun:test';
import { handleStatus } from '../handlers/status';
import { handleUrls } from '../handlers/urls';
import { handleUpdate } from '../handlers/update';
import { handleHealth } from '../handlers/health';
import { handleLogs } from '../handlers/logs';
import type { AgentConfig } from '../config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TEMP_DIRS: string[] = [];
const ORIGINAL_PATH = process.env.PATH;

afterEach(() => {
  if (ORIGINAL_PATH === undefined) delete process.env.PATH;
  else process.env.PATH = ORIGINAL_PATH;
  for (const dir of TEMP_DIRS.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixture(contents: unknown, raw = false): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miobridge-handler-test-'));
  TEMP_DIRS.push(dir);
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, raw ? String(contents) : JSON.stringify(contents));
  return file;
}

function fixtureDirectory(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miobridge-handler-configs-test-'));
  TEMP_DIRS.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(contents));
  }
  return dir;
}

function isolatedBinDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miobridge-handler-bin-test-'));
  TEMP_DIRS.push(dir);
  process.env.PATH = dir;
  return dir;
}

function singBoxFixture(port = 443): string {
  const inbound = {
    type: 'vless',
    tag: 'sing',
    listen_port: port,
    users: [{ uuid: '11111111-1111-4111-8111-111111111111' }],
  };
  return fixture({ inbounds: [inbound, inbound] });
}

function xrayFixture(port = 8443): string {
  const inbound = {
    protocol: 'vless',
    tag: 'xray',
    port,
    settings: { clients: [{ id: '22222222-2222-4222-8222-222222222222' }] },
  };
  return fixture({ inbounds: [inbound, inbound] });
}

function v2rayFixture(port = 9443, includeXrayDuplicate = false): string {
  const inbound = {
    protocol: 'vless',
    tag: 'v2ray',
    port,
    settings: { clients: [{ id: '33333333-3333-4333-8333-333333333333' }] },
  };
  const xrayDuplicate = {
    protocol: 'vless',
    tag: 'xray',
    port: 8443,
    settings: { clients: [{ id: '22222222-2222-4222-8222-222222222222' }] },
  };
  return fixture({
    inbounds: includeXrayDuplicate
      ? [inbound, inbound, xrayDuplicate]
      : [inbound, inbound],
  });
}

const MOCK_CONFIG: AgentConfig = {
  node: { id: 'node-sg', name: '新加坡', secret: 'test-secret' },
  kernels: [{ type: 'xray', configPath: '/nonexistent/xray.json' }],
  mihomo: { path: '/nonexistent/mihomo' },
  port: 3001,
};

function mockReq(overrides: any = {}): any {
  return {
    method: 'GET',
    url: '/api/status',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  };
}

describe('handleStatus', () => {
  it('should return StatusInfo JSON', async () => {
    const req = mockReq();
    const res = await handleStatus(req, MOCK_CONFIG);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(typeof body.data.nodesCount).toBe('number');
    expect(body.data.kernels).toHaveLength(3);
    expect(body.data.kernels.map((item: any) => item.type)).toEqual([
      'sing-box', 'xray', 'v2ray',
    ]);
    expect(body.data.kernels.find((item: any) => item.type === 'sing-box')).toMatchObject({
      monitored: false,
      accessible: false,
      nodesCount: 0,
    });
    expect(body.data).not.toHaveProperty('subscriptionExists');
    expect(body.data).not.toHaveProperty('clashExists');
    expect(body.data).not.toHaveProperty('rawExists');
    expect(body.data.mihomoAvailable).toBe(false);
  });

  it('should reject unauthenticated remote request', async () => {
    const req = mockReq({
      socket: { remoteAddress: '10.0.0.1' },
      headers: {},
    });
    const res = await handleStatus(req, {
      ...MOCK_CONFIG,
      node: { ...MOCK_CONFIG.node, secret: 'abc123' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('认证失败');
  });

  it('should accept request with valid HMAC signature', async () => {
    const secret = 'test-hmac-secret-32chars-long!';
    const timestamp = Date.now().toString();
    const method = 'GET';
    const reqPath = '/api/status';
    const payload = `${timestamp}\n${method}\n${reqPath}\n`;
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    const req = mockReq({
      method,
      url: reqPath,
      socket: { remoteAddress: '10.0.0.1' },
      headers: {
        'x-node-id': 'control-plane',
        'x-timestamp': timestamp,
        'x-signature': signature,
      },
    });
    const res = await handleStatus(req, {
      ...MOCK_CONFIG,
      node: { ...MOCK_CONFIG.node, secret },
    });
    expect(res.status).not.toBe(401);
  });

  it('reports an accessible configured kernel as undetected when its binary is absent', async () => {
    isolatedBinDir();
    const config: AgentConfig = {
      ...MOCK_CONFIG,
      node: { ...MOCK_CONFIG.node, secret: '' },
      kernels: [{ type: 'xray', configPath: xrayFixture() }],
    };

    const res = await handleStatus(mockReq({ headers: { host: 'agent.example' } }), config);
    const body = await res.json();

    expect(body.data.kernels.find((item: any) => item.type === 'xray')).toMatchObject({
      detected: false,
      monitored: true,
      accessible: true,
    });
  });

  it('detects an executable unmonitored kernel without discovering its config', async () => {
    const binDir = isolatedBinDir();
    const xrayBin = path.join(binDir, 'xray');
    fs.writeFileSync(xrayBin, '#!/bin/sh\necho "url [name] URL information"\n');
    fs.chmodSync(xrayBin, 0o755);
    const config: AgentConfig = {
      ...MOCK_CONFIG,
      node: { ...MOCK_CONFIG.node, secret: '' },
      kernels: [{ type: 'sing-box', configPath: singBoxFixture() }],
    };

    const res = await handleStatus(mockReq({ headers: { host: 'agent.example' } }), config);
    const body = await res.json();

    expect(body.data.kernels.find((item: any) => item.type === 'xray')).toMatchObject({
      detected: true,
      monitored: false,
      accessible: false,
      nodesCount: 0,
      configPaths: [],
    });
  });

  it('does not mistake a bare official core for a compatible 233boy wrapper', async () => {
    const binDir = isolatedBinDir();
    const xrayBin = path.join(binDir, 'xray');
    fs.writeFileSync(xrayBin, '#!/bin/sh\necho "Usage: xray [command]"\n');
    fs.chmodSync(xrayBin, 0o755);
    const config: AgentConfig = {
      ...MOCK_CONFIG,
      node: { ...MOCK_CONFIG.node, secret: '' },
      kernels: [{ type: 'sing-box', configPath: singBoxFixture() }],
    };

    const res = await handleStatus(mockReq({ headers: { host: 'agent.example' } }), config);
    const body = await res.json();

    expect(body.data.kernels.find((item: any) => item.type === 'xray')).toMatchObject({
      detected: false,
      monitored: false,
    });
  });

  it('does not detect a searchable directory named after a kernel as its binary', async () => {
    const binDir = isolatedBinDir();
    const xrayDir = path.join(binDir, 'xray');
    fs.mkdirSync(xrayDir);
    fs.chmodSync(xrayDir, 0o755);
    const config: AgentConfig = {
      ...MOCK_CONFIG,
      node: { ...MOCK_CONFIG.node, secret: '' },
      kernels: [{ type: 'sing-box', configPath: singBoxFixture() }],
    };

    const res = await handleStatus(mockReq({ headers: { host: 'agent.example' } }), config);
    const body = await res.json();

    expect(body.data.kernels.find((item: any) => item.type === 'xray')).toMatchObject({
      detected: false,
      monitored: false,
    });
  });
});

describe('handleUrls', () => {
  it('passes only the config filename to a 233boy wrapper so the local Agent exports its public URL', async () => {
    const binDir = isolatedBinDir();
    const wrapper = path.join(binDir, 'sing-box');
    fs.writeFileSync(wrapper, [
      '#!/bin/sh',
      'if [ "$1" = "help" ]; then echo "url [name] URL information"; exit 0; fi',
      'if [ "$1" = "url" ] && [ "$2" = "Hysteria2-55458.json" ]; then',
      '  echo "hysteria2://secret@203.0.113.10:55458#public-hysteria2"',
      '  exit 0',
      'fi',
      'exit 2',
    ].join('\n'));
    fs.chmodSync(wrapper, 0o755);
    const configs = fixtureDirectory({
      'Hysteria2-55458.json': { inbounds: [{ type: 'hysteria2', tag: 'fallback', listen_port: 55458, users: [{ password: 'secret' }] }] },
    });
    const config: AgentConfig = {
      ...MOCK_CONFIG,
      node: { ...MOCK_CONFIG.node, secret: '' },
      kernels: [{ type: 'sing-box', configPath: configs }],
    };

    const body = await (handleUrls(mockReq({ headers: { host: '127.0.0.1:3001' } }), config)).json();

    expect(body.data.sources).toEqual([{
      kernel: 'sing-box',
      url: 'hysteria2://secret@203.0.113.10:55458#public-hysteria2',
    }]);
    expect(body.data.sources[0].url).not.toContain('127.0.0.1');
  });

  it('expands every configured core, every config file, and every client', async () => {
    isolatedBinDir();
    const singBoxConfigs = fixtureDirectory({
      '01-hysteria2.json': { inbounds: [{ type: 'hysteria2', tag: 'hy2', listen_port: 2443, users: [{ password: 'hy-one' }, { password: 'hy-two' }], tls: { server_name: 'hy.example' } }] },
      '02-trojan.json': { inbounds: [{ type: 'trojan', tag: 'trojan', listen_port: 3443, users: [{ password: 'trojan-one' }] }] },
      'ignored.txt': { inbounds: [] },
    });
    const xray = fixture({ inbounds: [{
      protocol: 'vless', tag: 'xray', port: 4443,
      settings: { clients: [{ id: 'xray-one' }, { id: 'xray-two' }] },
    }, {
      protocol: 'shadowsocks', tag: 'xray-ss', port: 4444,
      settings: { method: 'aes-128-gcm', password: 'xray-ss-password', network: 'tcp,udp' },
    }] });
    const v2ray = fixture({ inbounds: [{
      protocol: 'trojan', tag: 'v2ray', port: 5443,
      settings: { clients: [{ password: 'v2ray-one' }, { password: 'v2ray-two' }] },
    }] });
    const config: AgentConfig = {
      ...MOCK_CONFIG,
      node: { ...MOCK_CONFIG.node, secret: '' },
      kernels: [
        { type: 'sing-box', configPath: singBoxConfigs },
        { type: 'xray', configPath: xray },
        { type: 'v2ray', configPath: v2ray },
      ],
    };

    const body = await (handleUrls(mockReq({ headers: { host: 'all.example' } }), config)).json();

    expect(body.data.sources).toHaveLength(8);
    expect(body.data.sources.filter((item: any) => item.kernel === 'sing-box')).toHaveLength(3);
    expect(body.data.sources.filter((item: any) => item.kernel === 'xray')).toHaveLength(3);
    expect(body.data.sources.filter((item: any) => item.kernel === 'v2ray')).toHaveLength(2);
    expect(body.data.kernels.find((item: any) => item.type === 'sing-box')).toMatchObject({
      accessible: true,
      nodesCount: 3,
      configPaths: [path.join(singBoxConfigs, '01-hysteria2.json'), path.join(singBoxConfigs, '02-trojan.json')],
    });
    expect(body.data.sources.map((item: any) => item.url)).toEqual(expect.arrayContaining([
      expect.stringContaining('hysteria2://hy-one@all.example:2443'),
      expect.stringContaining('hysteria2://hy-two@all.example:2443'),
      expect.stringContaining('trojan://trojan-one@all.example:3443'),
      expect.stringContaining('ss://'),
    ]));
  });

  it('returns structured sources for all kernels in stable order and removes exact duplicates', async () => {
    const config: AgentConfig = {
      ...MOCK_CONFIG,
      node: { ...MOCK_CONFIG.node, secret: '' },
      kernels: [
        { type: 'v2ray', configPath: v2rayFixture(9443, true) },
        { type: 'sing-box', configPath: singBoxFixture() },
        { type: 'xray', configPath: xrayFixture() },
      ],
    };

    const res = handleUrls(mockReq({ url: '/api/urls', headers: { host: 'agent.example:3001' } }), config);
    const body = await res.json();

    expect(body.data.sources.map((item: any) => item.kernel)).toEqual([
      'sing-box', 'xray', 'v2ray',
    ]);
    expect(new Set(body.data.sources.map((item: any) => item.url)).size).toBe(3);
    expect(body.data.kernels).toHaveLength(3);
    expect(body.data.kernels.every((item: any) => item.accessible)).toBe(true);
    expect(body.data).not.toHaveProperty('urls');
  });

  it('isolates malformed Xray JSON while other kernels remain accessible', async () => {
    const config: AgentConfig = {
      ...MOCK_CONFIG,
      node: { ...MOCK_CONFIG.node, secret: '' },
      kernels: [
        { type: 'sing-box', configPath: singBoxFixture() },
        { type: 'xray', configPath: fixture('{malformed', true) },
        { type: 'v2ray', configPath: v2rayFixture() },
      ],
    };

    const res = handleUrls(mockReq({ url: '/api/urls', headers: { host: 'agent.example' } }), config);
    const body = await res.json();
    const xray = body.data.kernels.find((item: any) => item.type === 'xray');

    expect(body.data.sources.map((item: any) => item.kernel)).toEqual(['sing-box', 'v2ray']);
    expect(xray).toMatchObject({ monitored: true, accessible: false, nodesCount: 0 });
    expect(xray.error).toBeString();
    expect(body.data.kernels.find((item: any) => item.type === 'sing-box')).toMatchObject({
      accessible: true,
      nodesCount: 1,
    });
    expect(body.data.kernels.find((item: any) => item.type === 'v2ray')).toMatchObject({
      accessible: true,
      nodesCount: 1,
    });
  });
});

describe('handleHealth', () => {
  it('should return health status JSON', () => {
    const req = mockReq();
    const res = handleHealth(req, MOCK_CONFIG);
    expect(res.status).toBe(200);
  });

  it('should include uptime and memory', async () => {
    const req = mockReq();
    const res = handleHealth(req, MOCK_CONFIG);
    const body = await res.json();
    expect(body.uptime).toBeDefined();
    expect(body.memory).toBeDefined();
    expect(body.version).toBe('1.2.11');
  });
});

describe('handleLogs', () => {
  it('should return logs JSON', async () => {
    const req = mockReq({ url: '/api/logs' });
    const res = await handleLogs(req, MOCK_CONFIG);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.file).toBeDefined();
    expect(Array.isArray(body.data.files)).toBe(true);
    expect(Array.isArray(body.data.lines)).toBe(true);
  });
});

describe('handleUpdate', () => {
  it('should return update result with message', async () => {
    const req = mockReq({ url: '/api/update' });
    const res = await handleUpdate(req, MOCK_CONFIG);
    const body = await res.json();
    expect(body.success).toBeDefined();
    expect(body.message).toBeDefined();
  });
});
