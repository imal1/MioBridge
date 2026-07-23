import { describe, expect, it } from 'vitest';
import {
  deployComponent, deployOperation, inputObject, kernelType,
  legacyStep, shellQuote, userSystemctl, validatePrivateKey,
} from '../../src/dashboard/server/ssh/util.js';
import { NodeTargets } from '../../src/dashboard/server/ssh/targets.js';

const PRIVATE_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----';

describe('ssh util', () => {
  it('inputObject accepts plain objects and rejects everything else', () => {
    expect(inputObject({ a: 1 })).toEqual({ a: 1 });
    for (const bad of [null, undefined, 'x', 42, []]) expect(() => inputObject(bad)).toThrow('请求内容无效');
  });

  it('shellQuote escapes embedded single quotes', () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
    expect(userSystemctl('restart', 'x')).toContain(`'systemctl' '--user' 'restart' 'x'`);
    expect(userSystemctl('daemon-reload')).toMatch(/^XDG_RUNTIME_DIR=/);
  });

  it('validatePrivateKey enforces size, format, and rejects encrypted keys', () => {
    expect(() => validatePrivateKey(PRIVATE_KEY)).not.toThrow();
    expect(() => validatePrivateKey('nope')).toThrow('无效的 SSH 私钥');
    expect(() => validatePrivateKey('a'.repeat(64 * 1024 + 1))).toThrow('64 KiB');
    expect(() => validatePrivateKey('-----BEGIN ENCRYPTED PRIVATE KEY-----\nx\n-----END ENCRYPTED PRIVATE KEY-----')).toThrow('带口令');
    expect(() => validatePrivateKey('-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nx')).toThrow('带口令');
  });

  it('coerces kernel/component/operation values or throws', () => {
    expect(kernelType('xray')).toBe('xray');
    expect(() => kernelType('nope')).toThrow('不支持的内核类型: nope');
    expect(deployComponent('agent')).toBe('agent');
    expect(deployComponent('mihomo')).toBe('mihomo');
    expect(deployComponent('xray')).toBe('xray');
    expect(() => deployComponent('nope')).toThrow('不支持的部署内容');
    expect(deployOperation('install')).toBe('install');
    expect(() => deployOperation('nope')).toThrow('不支持的部署操作');
  });

  it('maps legacy step aliases to canonical names', () => {
    expect(['preflight', 'install', 'configure', 'verify'].map(s => legacyStep(s as never)))
      .toEqual(['prechecking', 'installing', 'configuring', 'postchecking']);
    expect(legacyStep('installing')).toBe('installing');
  });
});

describe('NodeTargets.fromSsh', () => {
  const targets = new NodeTargets({} as never);

  it('builds a target from complete input', async () => {
    const target = await targets.fromSsh({ host: ' h ', user: ' u ', authMethod: 'password', password: 'pw' });
    expect(target.ssh).toMatchObject({ host: 'h', user: 'u', port: 22, authMethod: 'password', password: 'pw' });
    const key = await targets.fromSsh({ host: 'h', user: 'u', authMethod: 'privateKey', privateKey: PRIVATE_KEY, port: 2222 });
    expect(key.ssh).toMatchObject({ port: 2222, authMethod: 'privateKey', privateKey: PRIVATE_KEY });
  });

  it('rejects incomplete or invalid input', async () => {
    await expect(targets.fromSsh({ user: 'u', authMethod: 'password', password: 'p' })).rejects.toThrow('连接信息不完整');
    await expect(targets.fromSsh({ host: 'h', user: 'u', authMethod: 'password', password: 'p', port: 0 })).rejects.toThrow('SSH 端口无效');
    await expect(targets.fromSsh({ host: 'h', user: 'u', authMethod: 'password' })).rejects.toThrow('凭据不完整');
    await expect(targets.fromSsh({ host: 'h', user: 'u', authMethod: 'privateKey', privateKey: 'bad' })).rejects.toThrow('无效的 SSH 私钥');
  });
});
