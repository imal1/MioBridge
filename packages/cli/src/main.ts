#!/usr/bin/env node
import { CLI_VERSION, runCli } from './command.js';
import { createNodeCore } from './composition.js';
import { DependencySetupService } from './setup/service.js';
import { createNodeSetupAdapters } from './setup/nodeAdapters.js';
import { DashboardForegroundService, createNodeForegroundAdapters } from './dashboard/foreground.js';
import { DashboardSystemdService, createNodeSystemdAdapters } from './dashboard/systemd.js';
import { SelfMaintenanceService } from './self/service.js';
import { createNodeSelfMaintenanceAdapters } from './self/nodeAdapters.js';
import { LocalNodeConfigurationService } from './nodes/localConfiguration.js';
import { readFile } from 'node:fs/promises';

const output = {
  stdout(message: string) { process.stdout.write(`${message}\n`); },
  stderr(message: string) { process.stderr.write(`${message}\n`); },
};

const composition = createNodeCore({ metadata: { version: CLI_VERSION } });
const dashboardConfig = composition.core.config.getFullConfig().app;
const setupAdapters = createNodeSetupAdapters();
const localNode = new LocalNodeConfigurationService(composition.repository, setupAdapters);
const dashboardDaemon = new DashboardSystemdService(composition.paths, createNodeSystemdAdapters());
const maintenance = new SelfMaintenanceService({
  currentVersion: CLI_VERSION,
  executablePath: process.execPath,
  dashboardPath: `${composition.paths.distDir}/dashboard`,
  configDir: composition.paths.baseDir,
  adapters: createNodeSelfMaintenanceAdapters(),
  ...(process.env.MIOBRIDGE_REPOSITORY ? { repository: process.env.MIOBRIDGE_REPOSITORY } : {}),
  ...(process.env.MIOBRIDGE_VERSION ? { targetVersion: process.env.MIOBRIDGE_VERSION } : {}),
  ...(process.env.MIOBRIDGE_RELEASE_BASE_URL ? { releaseBaseUrl: process.env.MIOBRIDGE_RELEASE_BASE_URL } : {}),
});
const commandAbort = new AbortController();
const abortCommand = () => commandAbort.abort();
process.once('SIGINT', abortCommand);
process.once('SIGTERM', abortCommand);
const exitCode = await runCli(process.argv.slice(2), {
  createCore: () => composition.core,
  setup: new DependencySetupService({ paths: composition.paths, adapters: setupAdapters, configured: {
    ...composition.configuredBinaries,
    ...(process.env.MIOBRIDGE_MIHOMO_PATH ? { mihomo: process.env.MIOBRIDGE_MIHOMO_PATH } : {}),
    ...(process.env.MIOBRIDGE_SING_BOX_PATH ? { 'sing-box': process.env.MIOBRIDGE_SING_BOX_PATH } : {}),
  } }),
  localNode,
  maintenance: {
    upgrade: () => maintenance.upgrade(),
    async uninstall(purge) {
      await dashboardDaemon.uninstall();
      return maintenance.uninstall({ purge });
    },
  },
  dashboard: {
    foreground: () => new DashboardForegroundService(composition.paths, createNodeForegroundAdapters(composition)).run({
      ...(process.env.MIOBRIDGE_DASHBOARD_HOST ? { host: process.env.MIOBRIDGE_DASHBOARD_HOST } : {}),
      ...(process.env.MIOBRIDGE_DASHBOARD_PORT
        ? { port: Number(process.env.MIOBRIDGE_DASHBOARD_PORT) }
        : dashboardConfig?.port ? { port: dashboardConfig.port } : {}),
    }),
    daemon: action => dashboardDaemon[action](),
  },
  output,
  readTextFile: path => readFile(path, 'utf8'),
  signal: commandAbort.signal,
  version: CLI_VERSION,
});
process.removeListener('SIGINT', abortCommand);
process.removeListener('SIGTERM', abortCommand);
process.exitCode = exitCode;
