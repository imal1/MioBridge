import { defineConfig } from 'vitest/config';

/**
 * Coverage-only config, passed explicitly via `--config`. Running core, cli,
 * and the integration suite as one set of projects means a single v8 report
 * covers the source that all three exercise — in particular the dashboard
 * routes, which are driven from packages/integration and would otherwise be
 * missing from cli's numbers.
 *
 * The filename deliberately avoids `vitest.config.ts`: Vitest searches parent
 * directories for a config, so a discoverable root config would make each
 * package's own `vitest run` resolve these project paths relative to itself
 * (`packages/core/packages/core`) and fail at startup.
 */
export default defineConfig({
  test: {
    projects: ['packages/core', 'packages/cli', 'packages/integration'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['packages/core/src/**', 'packages/cli/src/**'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
