import { describe, it, expect } from 'vitest';
import { API_RETRY_METHODS, apiService, validateKernelDetections } from '../api';

// 测试 apiService 上 cluster 方法是否存在（接口契约）
describe('API Client - Cluster Methods', () => {
  it('never retries non-idempotent POST requests globally', () => {
    expect(API_RETRY_METHODS).toEqual(['get']);
    expect(API_RETRY_METHODS).not.toContain('post');
  });

  it('should expose getClusterStatus method', () => {
    expect(typeof apiService.getClusterStatus).toBe('function');
  });

  it('should expose triggerClusterUpdate method', () => {
    expect(typeof apiService.triggerClusterUpdate).toBe('function');
  });

  it('should expose clusterHealthCheck method', () => {
    expect(typeof apiService.clusterHealthCheck).toBe('function');
  });
});

describe('Kernel detection response validation', () => {
  const detection = (type: 'sing-box' | 'xray' | 'v2ray') => ({
    type, installed: true, version: '1.0.0', defaultConfigPath: `/etc/${type}/config.json`,
  });

  it('accepts exactly one result for every supported kernel and returns stable order', () => {
    expect(validateKernelDetections([detection('v2ray'), detection('sing-box'), detection('xray')]).map(item => item.type))
      .toEqual(['sing-box', 'xray', 'v2ray']);
  });

  it.each([
    [[detection('sing-box')]],
    [[detection('sing-box'), detection('xray'), detection('xray')]],
    [[detection('sing-box'), detection('xray'), { ...detection('v2ray'), installed: 'yes' }]],
    [[detection('sing-box'), detection('xray'), { ...detection('v2ray'), password: 'secret' }]],
    [[detection('sing-box'), detection('xray'), { ...detection('v2ray'), privateKey: 'secret-key' }]],
    [[detection('sing-box'), detection('xray'), { ...detection('v2ray'), sshPassphrase: 'secret' }]],
    [[detection('sing-box'), detection('xray'), { ...detection('v2ray'), apiToken: 'secret' }]],
  ])('rejects incomplete, duplicate, malformed, or credential-bearing results', (value) => {
    expect(() => validateKernelDetections(value)).toThrow('内核检测响应无效');
  });

  it('tolerates a benign unknown field instead of discarding the whole response', () => {
    // 服务端新增一个向后兼容的字段不应该让整块检测功能静默退化成「未检测到」。
    const extended = { ...detection('sing-box'), releaseChannel: 'stable' };
    const result = validateKernelDetections([extended, detection('xray'), detection('v2ray')]);
    expect(result.map(item => item.type)).toEqual(['sing-box', 'xray', 'v2ray']);
    // 但未知字段不会被带进结果对象里。
    expect(result[0]).not.toHaveProperty('releaseChannel');
  });

  it('carries the SSH-verified binary path through instead of dropping the response', () => {
    const withPath = { ...detection('sing-box'), binaryPath: '/usr/local/bin/sing-box' };
    const result = validateKernelDetections([withPath, detection('xray'), detection('v2ray')]);
    expect(result[0]?.binaryPath).toBe('/usr/local/bin/sing-box');
    expect(result[1]?.binaryPath).toBeUndefined();
  });

  it('rejects a binary path that is not absolute', () => {
    const relative = { ...detection('sing-box'), binaryPath: 'sing-box' };
    expect(() => validateKernelDetections([relative, detection('xray'), detection('v2ray')]))
      .toThrow('内核检测响应无效');
  });

  it('returns rebuilt detection objects instead of caller-owned values', () => {
    const input = [detection('sing-box'), detection('xray'), detection('v2ray')];
    const result = validateKernelDetections(input);
    expect(result[0]).not.toBe(input[0]);
    expect(result[0]).toEqual(input[0]);
  });
});
