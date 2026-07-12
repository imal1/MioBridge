/** Framework-neutral logging port used by core services. */
export interface CoreLogger {
  debug(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  info(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  warn(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  error(message: string, metadata?: Readonly<Record<string, unknown>>): void;
}

/** Package identity for headless-runtime and tracing probes. */
export const CORE_PACKAGE_NAME = '@miobridge/core' as const;

export { ConfigService } from './config/configService.js';
export { YamlService, type YamlServiceOptions } from './config/yamlService.js';
export {
  createRuntimePaths,
  vercelRuntimeBaseDir,
  type RuntimeEnvironment,
  type RuntimePaths,
  type RuntimePathsOptions,
} from './runtime/runtimePaths.js';
export {
  createStateStore,
  FileStateStore,
  RedisStateStore,
  type StateStore,
  type StateStoreOptions,
} from './state/stateStore.js';
export type { Config, FullConfig } from './types/config.js';
