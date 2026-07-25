import { defineConfig } from 'vitest/config';

/**
 * Root config used only by the CI coverage job. Running core, cli, and the
 * integration suite as one set of projects means a single v8 report covers the
 * source that all three exercise — in particular the dashboard routes, which
 * are driven from packages/integration and would otherwise be missing from
 * cli's numbers.
 *
 * Per-package `vitest run` is unaffected; each package still has its own
 * default config.
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
