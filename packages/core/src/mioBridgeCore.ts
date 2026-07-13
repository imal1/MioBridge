import { ArtifactService, type ArtifactServiceOptions, type LocalSourceCollector, type RemoteSourceCollector } from './artifacts/artifactService.js';
import { ConfigService } from './config/configService.js';
import { YamlService } from './config/yamlService.js';
import type { CoreLogger } from './index.js';
import type { RuntimePaths } from './runtime/runtimePaths.js';
import type { StateStore } from './state/stateStore.js';
import { StatusService, type BuildMetadata, type StatusKernel } from './status/statusService.js';

export interface MioBridgeCoreOptions {
  readonly paths: RuntimePaths; readonly state: StateStore; readonly logger: CoreLogger; readonly metadata: BuildMetadata;
  readonly local: LocalSourceCollector; readonly remote: RemoteSourceCollector;
  readonly mihomo: ArtifactServiceOptions['clash'] & StatusKernel;
  readonly now?: () => Date; readonly uptime?: () => number; readonly yaml?: YamlService;
}

export class MioBridgeCore {
  readonly yaml: YamlService; readonly config: ConfigService; readonly state: StateStore;
  readonly artifacts: ArtifactService; readonly status: StatusService;
  constructor(options: MioBridgeCoreOptions) {
    this.state = options.state;
    this.yaml = options.yaml ?? new YamlService({ paths: options.paths, logger: options.logger });
    this.config = new ConfigService(this.yaml, options.paths, options.metadata.version);
    const config = this.config.getConfig();
    const artifactOptions: ArtifactServiceOptions = {
      config, local: options.local, remote: options.remote, clash: options.mihomo, logger: options.logger,
      ...(options.now ? { now: options.now } : {}),
    };
    this.artifacts = new ArtifactService(artifactOptions);
    this.status = new StatusService({ config, mihomo: options.mihomo, metadata: options.metadata, logger: options.logger, ...(options.uptime ? { uptime: options.uptime } : {}) });
  }
  updateSubscription() { return this.artifacts.updateSubscription(); }
  getStatus() { return this.status.getStatus(); }
}
