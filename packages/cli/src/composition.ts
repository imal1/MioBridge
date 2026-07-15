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
  V2rayAdapter,
  XrayAdapter,
  YamlService,
  createRuntimePaths,
  createStateStore,
  type ClashConverter,
  type CoreLogger,
  type LocalSourceCollector,
  type KernelType,
  type ProcessOptions,
  type RemoteSourceCollector,
  type RuntimeEnvironment,
  type RuntimePaths,
  type StatusKernel,
  type StatusInfo,
} from '@miobridge/core';

const execFileAsync = promisify(execFile);

export interface NodeCoreOptions {
  readonly env?: RuntimeEnvironment & Record<string, string | undefined>;
  readonly homeDir?: string;
  readonly applicationRoot?: string;
  readonly platformBaseDir?: string;
  readonly logger?: CoreLogger;
  readonly metadata?: { readonly version: string; readonly gitCommit?: string; readonly buildTime?: string };
  readonly local?: LocalSourceCollector & {
    getConfigPaths?(): Promise<string[]>;
    getVersion?(): Promise<string | undefined>;
  };
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
  readonly local: LocalSourceCollector & {
    getConfigPaths?(): Promise<string[]>;
    getVersion?(): Promise<string | undefined>;
  };
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
  const kernelFs = createKernelFileSystem();
  const state = createStateStore({ paths, env, logger });
  const repository = new NodeRepository(state);
  const yaml = new YamlService({ paths, logger });
  const configService = new ConfigService(yaml, paths, options.metadata?.version ?? '1.0.0');
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
  const defaultConfigPaths: Record<Exclude<KernelType, 'sing-box'>, string> = {
    xray: '/usr/local/etc/xray/config.json',
    v2ray: '/etc/v2ray/config.json',
  };
  const resolveKernelExecutable = async (type: KernelType): Promise<{ path: string; version?: string } | undefined> => {
    for (const candidate of paths.binaryCandidates(type)) {
      try {
        const result = await processRunner.run(candidate, ['version'], { timeout: 5000 });
        const output = `${result.stdout}\n${result.stderr}`;
        const version = output.match(/\bv?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0];
        return { path: candidate, ...(version ? { version } : {}) };
      } catch { /* next candidate */ }
    }
    return undefined;
  };
  let getHostStatus: (() => Promise<StatusInfo>) | undefined;
  const aggregation = new NodeAggregationService(repository, agent, {
    async status(node) {
      const startedAt = Date.now();
      const [available, configPaths, hostStatus, otherKernels] = await Promise.all([
        local.isAvailable(),
        local.getConfigPaths?.() ?? Promise.resolve([]),
        getHostStatus?.(),
        Promise.all((['xray', 'v2ray'] as const).map(async type => {
          const configured = node.kernels.find(kernel => kernel.type === type);
          const configPath = configured?.configPath ?? defaultConfigPaths[type];
          const executable = await resolveKernelExecutable(type);
          const adapter = type === 'xray'
            ? new XrayAdapter(kernelFs, logger, configPath)
            : new V2rayAdapter(kernelFs, logger, configPath);
          const configAvailable = await adapter.isAvailable();
          const sources = executable && configured && configAvailable ? await adapter.extractNodeUrls() : [];
          const nodesCount = sources.flatMap(value => value.split(/\r?\n/)).filter(value => value.trim()).length;
          return {
            type,
            detected: Boolean(executable),
            monitored: Boolean(configured),
            accessible: Boolean(executable && configured && configAvailable),
            nodesCount,
            configPaths: configured ? [configPath] : [],
            ...(executable?.version ? { version: executable.version } : {}),
            ...(!executable
              ? { error: `本机 ${type} 不可用` }
              : configured && !configAvailable ? { error: `配置文件不存在：${configPath}` } : {}),
          };
        })),
      ]);
      const urls = available ? await local.extractNodeUrls() : [];
      const singBoxNodes = urls.flatMap(value => value.split(/\r?\n/)).filter(value => value.trim()).length;
      const nodesCount = singBoxNodes + otherKernels.reduce((sum, kernel) => sum + kernel.nodesCount, 0);
      const version = await local.getVersion?.();
      return {
        nodeId: node.id,
        name: node.name,
        kind: 'local' as const,
        configuredKernels: node.kernels,
        kernels: [{
          type: 'sing-box' as const,
          detected: available,
          monitored: node.kernels.some(kernel => kernel.type === 'sing-box'),
          accessible: available,
          nodesCount: singBoxNodes,
          configPaths,
          ...(version ? { version } : {}),
          ...(!available ? { error: '本机 sing-box 不可用' } : {}),
        }, ...otherKernels],
        location: node.location,
        online: true,
        latency: Date.now() - startedAt,
        nodesCount,
        ...(hostStatus ? {
          subscriptionExists: hostStatus.subscriptionExists,
          clashExists: hostStatus.clashExists,
          mihomoAvailable: hostStatus.mihomoAvailable,
          version: hostStatus.version,
          uptime: hostStatus.uptime,
        } : {}),
      };
    },
  });
  const remote = options.remote ?? aggregation;
  const mihomo = options.mihomo ?? new MihomoAdapter({
    paths, process: processRunner, fs: kernelFs, logger,
    runtimeDir: join(tmpdir(), 'miobridge-mihomo'), configuredPath: config.mihomoPath,
    ...(env.MIOBRIDGE_MIHOMO_PATH ? { envPath: env.MIOBRIDGE_MIHOMO_PATH } : {}),
  });
  const configuredLocal = {
    isConfigured: () => options.local ? Promise.resolve(true) : repository.isLocalNodeConfigured(),
    async isAvailable() {
      if (options.local) return local.isAvailable();
      const configured = (await repository.list({ enabledOnly: false })).find(node => node.kind === 'local');
      if (!configured) return false;
      const availability = await Promise.all(configured.kernels.map(async kernel => {
        if (kernel.type === 'sing-box') return local.isAvailable();
        const configPath = kernel.configPath ?? defaultConfigPaths[kernel.type];
        const adapter = kernel.type === 'xray'
          ? new XrayAdapter(kernelFs, logger, configPath)
          : new V2rayAdapter(kernelFs, logger, configPath);
        return Boolean(await resolveKernelExecutable(kernel.type)) && adapter.isAvailable();
      }));
      return availability.some(Boolean);
    },
    async extractNodeUrls() {
      if (options.local) return local.extractNodeUrls();
      const configured = (await repository.list({ enabledOnly: false })).find(node => node.kind === 'local');
      if (!configured) return [];
      const sources = await Promise.all(configured.kernels.map(kernel => {
        if (kernel.type === 'sing-box') return local.extractNodeUrls();
        const configPath = kernel.configPath ?? defaultConfigPaths[kernel.type];
        const adapter = kernel.type === 'xray'
          ? new XrayAdapter(kernelFs, logger, configPath)
          : new V2rayAdapter(kernelFs, logger, configPath);
        return adapter.extractNodeUrls();
      }));
      return sources.flat();
    },
  };
  const core = new MioBridgeCore({
    paths, state, logger, metadata: options.metadata ?? { version: '1.0.0' }, yaml,
    local: configuredLocal, remote, mihomo,
    ...(options.uptime ? { uptime: options.uptime } : {}),
  });
  getHostStatus = () => core.getStatus();
  return { core, paths, repository, aggregation, agent, local, mihomo, configuredBinaries: {
    ...(fullConfig.binaries?.mihomo_path ? { mihomo: fullConfig.binaries.mihomo_path } : {}),
    ...(fullConfig.binaries?.sing_box_path ? { 'sing-box': fullConfig.binaries.sing_box_path } : {}),
  } };
}
