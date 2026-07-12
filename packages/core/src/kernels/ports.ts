import type { CoreLogger } from '../index.js';

export interface ProcessResult { readonly stdout: string; readonly stderr: string }
export interface ProcessOptions { readonly timeout: number; readonly cwd?: string; readonly env?: NodeJS.ProcessEnv }
export interface ProcessRunner {
  run(command: string, args: readonly string[], options: ProcessOptions): Promise<ProcessResult>;
  which(command: string): Promise<string | null>;
}
export interface KernelFileSystem {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
}
export type KernelLogger = CoreLogger;
