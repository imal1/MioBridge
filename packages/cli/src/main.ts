#!/usr/bin/env node
import { CLI_VERSION, runCli } from './command.js';
import { createNodeCore } from './composition.js';
import { DependencySetupService } from './setup/service.js';
import { createNodeSetupAdapters } from './setup/nodeAdapters.js';
import { DashboardForegroundService, createNodeForegroundAdapters, resolveDashboardRuntime } from './dashboard/foreground.js';
import { DashboardSystemdService, createNodeSystemdAdapters } from './dashboard/systemd.js';

const output = {
  stdout(message: string) { process.stdout.write(`${message}\n`); },
  stderr(message: string) { process.stderr.write(`${message}\n`); },
};

const composition = createNodeCore({ metadata: { version: CLI_VERSION } });
const dashboardRuntime = await resolveDashboardRuntime(composition.paths, composition.configuredBinaries.bun);
const dashboardEnv = { ...process.env, PATH: dashboardRuntime.effectivePath };
const exitCode = await runCli(process.argv.slice(2), {
  createCore: () => composition.core,
  setup: new DependencySetupService({ paths: composition.paths, adapters: createNodeSetupAdapters(), configured: {
    ...composition.configuredBinaries,
    ...(process.env.MIOBRIDGE_MIHOMO_PATH ? { mihomo: process.env.MIOBRIDGE_MIHOMO_PATH } : {}),
    ...(process.env.MIOBRIDGE_SING_BOX_PATH ? { 'sing-box': process.env.MIOBRIDGE_SING_BOX_PATH } : {}),
  } }),
  dashboard: {
    foreground: () => new DashboardForegroundService(composition.paths, createNodeForegroundAdapters(dashboardEnv), dashboardRuntime).run(),
    daemon: action => new DashboardSystemdService(composition.paths, createNodeSystemdAdapters({ env: dashboardEnv }))[action](),
  },
  output,
  version: CLI_VERSION,
});
process.exitCode = exitCode;
