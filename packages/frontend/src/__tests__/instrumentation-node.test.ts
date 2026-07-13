// TDD RED phase for Task 7: NodeManager startup initialization
// These tests verify NodeManager.loadNodes() is called during app startup
// and that failures in NodeManager init don't crash the app.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so mock fns are available in both vi.mock factories and tests
const {
  mockLoadNodes,
  mockHasRemoteNodes,
  mockEnsureDirectories,
  mockUpdateSubscription,
  mockCheckHealth,
  mockGetVersion,
  mockCheckSingBox,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockLoadNodes: vi.fn().mockResolvedValue([]),
  mockHasRemoteNodes: vi.fn().mockReturnValue(false),
  mockEnsureDirectories: vi.fn().mockResolvedValue(undefined),
  mockUpdateSubscription: vi.fn().mockResolvedValue({ nodesCount: 0, message: 'ok' }),
  mockCheckHealth: vi.fn().mockResolvedValue(true),
  mockGetVersion: vi.fn().mockResolvedValue({ version: '1.0.0' }),
  mockCheckSingBox: vi.fn().mockResolvedValue(true),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('@/server/services/nodeManager', () => ({
  NodeManager: {
    getInstance: vi.fn(() => ({
      loadNodes: mockLoadNodes,
      hasRemoteNodes: mockHasRemoteNodes,
    })),
  },
}));

vi.mock('fs-extra', () => ({ ensureDir: mockEnsureDirectories }));

vi.mock('@/server/core', () => ({
  corePaths: { dataDir: '/tmp/data', logDir: '/tmp/log', backupDir: '/tmp/backup' },
  mioBridgeCore: { updateSubscription: mockUpdateSubscription },
  mihomoAdapter: { checkHealth: mockCheckHealth, getVersion: mockGetVersion },
  singBoxAdapter: { isAvailable: mockCheckSingBox },
}));

vi.mock('@/server/config', () => ({
  config: { autoUpdateCron: null },
}));

vi.mock('@/server/utils/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  },
}));

vi.mock('node-cron', () => ({
  default: { schedule: vi.fn() },
}));

describe('Task 7: NodeManager Startup Initialization', () => {
  beforeEach(() => {
    vi.resetModules();
    mockLoadNodes.mockReset().mockResolvedValue([]);
    mockEnsureDirectories.mockReset().mockResolvedValue(undefined);
    mockCheckHealth.mockReset().mockResolvedValue(true);
    mockGetVersion.mockReset().mockResolvedValue({ version: '1.0.0' });
    mockCheckSingBox.mockReset().mockResolvedValue(true);
    mockLoggerInfo.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
  });

  describe('loadNodes on startup', () => {
    it('should call NodeManager.loadNodes() during app startup', async () => {
      await import('../instrumentation-node');

      // NodeManager.loadNodes() must have been called
      expect(mockLoadNodes).toHaveBeenCalled();
    });
  });

  describe('graceful failure handling', () => {
    it('should not crash the app when NodeManager.loadNodes() throws', async () => {
      mockLoadNodes.mockRejectedValue(new Error('Connection refused'));

      // Import should not throw - the app should continue
      await expect(
        import('../instrumentation-node'),
      ).resolves.toBeDefined();
    });

    it('should continue initializing other services when NodeManager fails', async () => {
      mockLoadNodes.mockRejectedValue(new Error('Connection refused'));

      await import('../instrumentation-node');

      // Other services should still initialize
      expect(mockEnsureDirectories).toHaveBeenCalled();
      expect(mockCheckHealth).toHaveBeenCalled();
      expect(mockCheckSingBox).toHaveBeenCalled();
    });
  });
});
