import { execFile } from 'node:child_process'
import * as fs from 'fs-extra'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import {
  AgentClient, MihomoAdapter, MioBridgeCore, NodeAggregationService, NodeRepository,
  SingBoxAdapter, createRuntimePaths, createStateStore, vercelRuntimeBaseDir,
  type ProcessOptions,
} from '@miobridge/core'
import { config, getFullConfig } from './config'
import { BUILD_TIME, GIT_COMMIT, VERSION } from './version'
import { logger } from './utils/logger'
import { resolveApplicationRoot } from './applicationRoot'

const execFileAsync = promisify(execFile)
const applicationRoot = resolveApplicationRoot()
const fullConfig = getFullConfig()
export const corePaths = createRuntimePaths({
  applicationRoot,
  ...(process.env.VERCEL === '1' ? { platformBaseDir: vercelRuntimeBaseDir() } : {}),
})

const processRunner = {
  async run(command: string, args: readonly string[], options: ProcessOptions) {
    const result = await execFileAsync(command, [...args], {
      cwd: options.cwd, env: options.env, timeout: options.timeout, maxBuffer: 10 * 1024 * 1024,
    })
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
  },
  async which(command: string) {
    for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
      const candidate = path.join(directory, command)
      try { await fs.access(candidate, fs.constants.X_OK); return candidate } catch { /* continue */ }
    }
    return null
  },
}
const fileSystem = {
  exists: (file: string) => fs.pathExists(file),
  mkdir: (directory: string) => fs.ensureDir(directory).then(() => undefined),
  readFile: (file: string) => fs.readFile(file, 'utf8'),
  writeFile: (file: string, content: string) => fs.writeFile(file, content, 'utf8').then(() => undefined),
  remove: (file: string) => fs.remove(file),
}

export const coreState = createStateStore({ paths: corePaths })
export const nodeRepository = new NodeRepository(coreState)
export const nodeAggregation = new NodeAggregationService(nodeRepository, new AgentClient())
export const singBoxAdapter = new SingBoxAdapter({
  process: processRunner, logger, paths: corePaths,
  configuredPath: fullConfig?.binaries?.sing_box_path,
  configs: config.singBoxConfigs, requestTimeout: config.requestTimeout,
})
export const mihomoAdapter = new MihomoAdapter({
  paths: corePaths, process: processRunner, fs: fileSystem, logger,
  runtimeDir: path.join(os.tmpdir(), 'miobridge-mihomo'), envPath: process.env.MIOBRIDGE_MIHOMO_PATH,
  configuredPath: config.mihomoPath,
})
export const mioBridgeCore = new MioBridgeCore({
  paths: corePaths, state: coreState, logger,
  metadata: { version: VERSION, gitCommit: GIT_COMMIT, buildTime: BUILD_TIME },
  local: singBoxAdapter, remote: nodeAggregation, mihomo: mihomoAdapter,
})
