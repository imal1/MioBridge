import { ArtifactService, type ArtifactServiceOptions, type LocalSourceCollector, type RemoteSourceCollector } from './artifacts/artifactService.js';
import { ConfigService } from './config/configService.js';
import { LocalLogService, type LocalLogQuery } from './logs/localLogService.js';
import { MetricsService, type ClusterMetricsSource } from './metrics/metricsService.js';
import { YamlService } from './config/yamlService.js';
import type { CoreLogger } from './index.js';
import type { RuntimePaths } from './runtime/runtimePaths.js';
import type { StateStore } from './state/stateStore.js';
import { StatusService, type BuildMetadata, type StatusKernel } from './status/statusService.js';

export interface MioBridgeCoreOptions {
  readonly paths: RuntimePaths; readonly state: StateStore; readonly logger: CoreLogger; readonly metadata: BuildMetadata;
  readonly local: LocalSourceCollector; readonly remote: RemoteSourceCollector;
  readonly mihomo: ArtifactServiceOptions['clash'] & StatusKernel;
  readonly clusterMetrics?: ClusterMetricsSource;
  readonly now?: () => Date; readonly uptime?: () => number; readonly yaml?: YamlService;
}

export class MioBridgeCore {
  readonly yaml: YamlService; readonly config: ConfigService; readonly state: StateStore;
  readonly artifacts: ArtifactService; readonly status: StatusService;
  readonly logs: LocalLogService; readonly metrics: MetricsService;
  constructor(options: MioBridgeCoreOptions) {
    this.state = options.state;
    this.yaml = options.yaml ?? new YamlService({ paths: options.paths, logger: options.logger });
    this.config = new ConfigService(this.yaml, options.paths, options.metadata.version);
    const config = this.config.getConfig();
    const artifactOptions: ArtifactServiceOptions = {
      config, local: options.local, remote: options.remote, clash: options.mihomo, logger: options.logger, state: options.state,
      ...(options.now ? { now: options.now } : {}),
    };
    this.artifacts = new ArtifactService(artifactOptions);
    this.status = new StatusService({ config, mihomo: options.mihomo, metadata: options.metadata, logger: options.logger, ...(options.uptime ? { uptime: options.uptime } : {}) });
    this.logs = new LocalLogService(config.logDir, options.now);
    this.metrics = new MetricsService(
      () => this.status.getStatus(), options.state, options.clusterMetrics, options.now,
    );
  }
  updateSubscription() { return this.artifacts.updateSubscription(); }
  preflightSubscription() { return this.artifacts.preflight(); }
  getStatus() { return this.status.getStatus(); }
  getConfigPath() { return this.config.getConfigPath(); }
  getEffectiveConfig() { return this.config.getFullConfig(); }
  getConfigValue(path: string) { return this.config.getConfigByPath(path); }
  async setConfigValue(path: string, value: unknown) { return this.config.setConfigByPath(path, value); }
  async setConfigValues(changes: readonly { path: string; value: unknown }[]) { return this.config.setConfigValues(changes); }
  async restoreLastGoodConfig() { return this.config.restoreLastGood(); }
  validateConfig(source?: string) { return this.config.validate(source); }
  getLocalLogs(options: LocalLogQuery = {}) { return this.logs.query(options); }
  followLocalLogs(options: LocalLogQuery = {}) { return this.logs.follow(options); }
  getMetricsSnapshot() { return this.metrics.snapshot(); }
}
