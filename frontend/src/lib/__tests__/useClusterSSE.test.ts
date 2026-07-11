// @vitest-environment jsdom
// TDD RED phase for Phase C: useClusterSSE hook
// Tests verify the React hook for SSE-based cluster status updates

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// The hook doesn't exist yet — import will fail until GREEN phase
let useClusterSSE: any;

// Mock EventSource
class MockEventSource {
  url: string;
  onmessage: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onopen: ((e: any) => void) | null = null;
  readyState: number = 0;
  static instances: MockEventSource[] = [];

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.readyState = 2;
  }
}

describe('Phase C: useClusterSSE hook', () => {
  const mockInitialData = {
    totalNodes: 3,
    onlineNodes: 2,
    totalProxies: 35,
    nodes: [
      { nodeId: 'local', name: '本地', configuredKernels: [{ type: 'sing-box' }], kernels: [
        { type: 'sing-box', detected: true, monitored: true, accessible: true, nodesCount: 23, configPaths: ['/etc/sing-box/config.json'] },
        { type: 'xray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
        { type: 'v2ray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
      ], location: '本地', online: true, latency: 0, nodesCount: 23 },
      { nodeId: 'node-sg', name: '新加坡', configuredKernels: [{ type: 'xray' }], kernels: [
        { type: 'sing-box', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
        { type: 'xray', detected: true, monitored: true, accessible: true, nodesCount: 12, configPaths: ['/etc/xray/config.json'] },
        { type: 'v2ray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
      ], location: '新加坡', online: true, latency: 45, nodesCount: 12 },
      { nodeId: 'node-jp', name: '东京', configuredKernels: [{ type: 'sing-box' }], kernels: [
        { type: 'sing-box', detected: true, monitored: true, accessible: false, nodesCount: 0, configPaths: [], error: 'offline' },
        { type: 'xray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
        { type: 'v2ray', detected: false, monitored: false, accessible: false, nodesCount: 0, configPaths: [] },
      ], location: '东京', online: false, error: '连接超时' },
    ],
    lastUpdated: new Date().toISOString(),
  };

  beforeEach(async () => {
    MockEventSource.instances = [];
    // Stub global EventSource
    (globalThis as any).EventSource = MockEventSource;

    try {
      const mod = await import('@/lib/useClusterSSE');
      useClusterSSE = mod.useClusterSSE;
    } catch {
      useClusterSSE = undefined;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be importable (hook exists)', () => {
    expect(typeof useClusterSSE).toBe('function');
  });

  it('should return initial data before SSE connects', () => {
    const { result } = renderHook(() => useClusterSSE(mockInitialData));
    expect(result.current.totalNodes).toBe(3);
    expect(result.current.onlineNodes).toBe(2);
    expect(result.current.nodes).toHaveLength(3);
  });

  it('should create an EventSource to /api/cluster/events', () => {
    renderHook(() => useClusterSSE(mockInitialData));
    expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1);
    expect(MockEventSource.instances[0].url).toBe('/api/cluster/events');
  });

  it('should update data when SSE message arrives', () => {
    const { result } = renderHook(() => useClusterSSE(mockInitialData));

    const updatedData = {
      ...mockInitialData,
      onlineNodes: 3,
      lastUpdated: new Date().toISOString(),
    };

    act(() => {
      const es = MockEventSource.instances[0];
      if (es.onmessage) {
        es.onmessage({ data: JSON.stringify(updatedData) });
      }
    });

    expect(result.current.onlineNodes).toBe(3);
  });

  it('should close EventSource on unmount', () => {
    const { unmount } = renderHook(() => useClusterSSE(mockInitialData));
    const es = MockEventSource.instances[0];
    expect(es.readyState).not.toBe(2); // not closed yet
    unmount();
    expect(es.readyState).toBe(2); // closed after unmount
  });
});
