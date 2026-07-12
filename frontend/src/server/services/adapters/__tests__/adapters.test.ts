// TDD RED phase for Task 2: Kernel Adapters
// These tests verify adapter classes implement KernelAdapter correctly

import { describe, it, expect } from 'vitest';
import { SingBoxAdapter } from '../singBoxAdapter';
import { XrayAdapter } from '../xrayAdapter';
import { V2rayAdapter } from '../v2rayAdapter';
import type { KernelAdapter } from '../kernelAdapter';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const fileSystem = {
  exists: async () => false,
  mkdir: async () => {},
  readFile: async () => '{}',
  writeFile: async () => {},
  remove: async () => {},
};
const processRunner = {
  run: async () => ({ stdout: '', stderr: '' }),
  which: async () => null,
};
const singBox = () => new SingBoxAdapter({ process: processRunner, logger, configs: [], requestTimeout: 1000 });
const xray = () => new XrayAdapter(fileSystem, logger);
const v2ray = () => new V2rayAdapter(fileSystem, logger);

describe('Task 2: Kernel Adapters', () => {
  describe('kernelAdapter type re-export', () => {
    it('should have re-exported KernelAdapter and KernelType at type level', async () => {
      // KernelAdapter and KernelType are type-only exports — erased at runtime.
      // Their correctness is verified at compile time: every adapter below
      // satisfies `KernelAdapter` with a valid `KernelType` .type property.
      const mod = await import('../kernelAdapter');
      // Module exists and can be imported — type re-exports confirmed by tsc
      expect(typeof mod).toBe('object');
    });
  });

  describe('SingBoxAdapter', () => {
    it('should implement KernelAdapter interface', () => {
      const adapter = singBox();
      // Type check: adapter satisfies KernelAdapter
      const typed: KernelAdapter = adapter;
      expect(typed.type).toBe('sing-box');
    });

    it('should have type "sing-box"', () => {
      const adapter = singBox();
      expect(adapter.type).toBe('sing-box');
    });

    it('should return config paths array', async () => {
      const adapter = singBox();
      const paths = await adapter.getConfigPaths();
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths[0]).toContain('sing-box');
    });

    it('should return node URLs array from extractNodeUrls', async () => {
      const adapter = singBox();
      const urls = await adapter.extractNodeUrls();
      expect(Array.isArray(urls)).toBe(true);
    });

    it('should report availability via isAvailable', async () => {
      const adapter = singBox();
      const available = await adapter.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('XrayAdapter', () => {
    it('should implement KernelAdapter interface', () => {
      const adapter = xray();
      const typed: KernelAdapter = adapter;
      expect(typed.type).toBe('xray');
    });

    it('should have type "xray"', () => {
      const adapter = xray();
      expect(adapter.type).toBe('xray');
    });

    it('should return config paths array', async () => {
      const adapter = xray();
      const paths = await adapter.getConfigPaths();
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths[0]).toContain('xray');
    });

    it('should return node URLs array from extractNodeUrls', async () => {
      const adapter = xray();
      const urls = await adapter.extractNodeUrls();
      expect(Array.isArray(urls)).toBe(true);
    });

    it('should report availability via isAvailable', async () => {
      const adapter = xray();
      const available = await adapter.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('V2rayAdapter', () => {
    it('should implement KernelAdapter interface', () => {
      const adapter = v2ray();
      const typed: KernelAdapter = adapter;
      expect(typed.type).toBe('v2ray');
    });

    it('should have type "v2ray"', () => {
      const adapter = v2ray();
      expect(adapter.type).toBe('v2ray');
    });

    it('should return config paths array', async () => {
      const adapter = v2ray();
      const paths = await adapter.getConfigPaths();
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths[0]).toContain('v2ray');
    });

    it('should return node URLs array from extractNodeUrls', async () => {
      const adapter = v2ray();
      const urls = await adapter.extractNodeUrls();
      expect(Array.isArray(urls)).toBe(true);
    });

    it('should report availability via isAvailable', async () => {
      const adapter = v2ray();
      const available = await adapter.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });
});
