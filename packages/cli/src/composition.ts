import { execFile } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import {
  AgentClient,
  ConfigService,
  MihomoAdapter,
  MioBridgeCore,
  NodeAggregationService,
  NodeRepository,
  SingBoxAdapter,
  YamlService,
  createRuntimePaths,
  createStateStore,
  type ClashConverter,
  type CoreLogger,
  type LocalSourceCollector,
  type ProcessOptions,
  type RemoteSourceCollector,
  type RuntimeEnvironment,
  type RuntimePaths,
  type StatusKernel,
} from '@miobridge/core';

const execFileAsync = promisify(execFile);

export interface NodeCoreOptions {
  readonly env?: RuntimeEnvironment & Record<string, string | undefined>;
  readonly homeDir?: string;
  readonly applicationRoot?: string;
  readonly platformBaseDir?: string;
  readonly logger?: CoreLogger;
  readonly metadata?: { readonly version: string; readonly gitCommit?: string; readonly buildTime?: string };
  readonly local?: LocalSourceCollector;
  readonly remote?: RemoteSourceCollector;
  readonly mihomo?: ClashConverter & StatusKernel;
  readonly uptime?: () => number;
}

const silentLogger: CoreLogger = {
  debug() {}, info() {}, warn() {}, error() {},
};

function createProcessRunner(env: Record<string, string | undefined>) {
  return {
    async run(command: string, args: readonly string[], options: ProcessOptions) {
      try {
        const result = await execFileAsync(command, [...args], {
          ...(options.cwd ? { cwd: options.cwd } : {}),
          env: options.env ?? env,
          ...(options.timeout ? { timeout: options.timeout } : {}),
          maxBuffer: 10 * 1024 * 1024,
        });
        return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
      } catch (error) {
        const failure = error as Error & { stdout?: string; stderr?: string; code?: number };
        throw new Error(failure.stderr?.trim() || failure.message, { cause: failure });
      }
    },
    async which(command: string) {
      for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
        const candidate = join(directory, command);
        try { await access(candidate, constants.X_OK); return candidate; } catch { /* continue */ }
      }
      return null;
    },
  };
}

function createKernelFileSystem() {
  return {
    async exists(file: string) { try { await access(file); return true; } catch { return false; } },
    async mkdir(directory: string) { await mkdir(directory, { recursive: true }); },
    readFile: (file: string) => readFile(file, 'utf8'),
    async writeFile(file: string, content: string) { await writeFile(file, content, 'utf8'); },
    async remove(file: string) { await rm(file, { recursive: true, force: true }); },
  };
}

export interface NodeCoreComposition {
  readonly core: MioBridgeCore;
  readonly paths: RuntimePaths;
  readonly repository: NodeRepository;
  readonly aggregation: NodeAggregationService;
  readonly agent: AgentClient;
  readonly mihomo: ClashConverter & StatusKernel;
  readonly configuredBinaries: Readonly<{ mihomo?: string; 'sing-box'?: string }>;
}

export function createNodeCore(options: NodeCoreOptions = {}): NodeCoreComposition {
  const env = options.env ?? process.env;
  const paths = createRuntimePaths({
    env,
    ...(options.homeDir ? { homeDir: options.homeDir } : {}),
    ...(options.applicationRoot ? { applicationRoot: options.applicationRoot } : {}),
    ...(options.platformBaseDir ? { platformBaseDir: options.platformBaseDir } : {}),
  });
  const logger = options.logger ?? silentLogger;
  const processRunner = createProcessRunner(env);
  const state = createStateStore({ paths, env, logger });
  const repository = new NodeRepository(state);
  const yaml = new YamlService({ paths, logger });
  const configService = new ConfigService(yaml, paths, options.metadata?.version ?? '0.1.0');
  const fullConfig = configService.getFullConfig();
  const config = configService.getConfig();
  const local = options.local ?? new SingBoxAdapter({
    process: processRunner, logger, configs: config.singBoxConfigs,
    requestTimeout: config.requestTimeout, paths,
    ...(fullConfig.binaries?.sing_box_path
      ? { configuredPath: fullConfig.binaries.sing_box_path }
      : {}),
  });
  const agent = new AgentClient();
  const aggregation = new NodeAggregationService(repository, agent);
  const remote = options.remote ?? aggregation;
  const mihomo = options.mihomo ?? new MihomoAdapter({
    paths, process: processRunner, fs: createKernelFileSystem(), logger,
    runtimeDir: join(tmpdir(), 'miobridge-mihomo'), configuredPath: config.mihomoPath,
    ...(env.MIOBRIDGE_MIHOMO_PATH ? { envPath: env.MIOBRIDGE_MIHOMO_PATH } : {}),
  });
  const core = new MioBridgeCore({
    paths, state, logger, metadata: options.metadata ?? { version: '0.1.0' }, yaml,
    local, remote, mihomo,
    ...(options.uptime ? { uptime: options.uptime } : {}),
  });
  return { core, paths, repository, aggregation, agent, mihomo, configuredBinaries: {
    ...(fullConfig.binaries?.mihomo_path ? { mihomo: fullConfig.binaries.mihomo_path } : {}),
    ...(fullConfig.binaries?.sing_box_path ? { 'sing-box': fullConfig.binaries.sing_box_path } : {}),
  } };
}
