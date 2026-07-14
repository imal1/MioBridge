import { homedir } from 'node:os';
import { delimiter, join, resolve, sep } from 'node:path';

export interface RuntimeEnvironment {
  readonly MIOBRIDGE_CONFIG_DIR?: string;
  readonly PATH?: string;
}

export interface RuntimePathsOptions {
  readonly env?: RuntimeEnvironment;
  readonly homeDir?: string;
  readonly applicationRoot?: string;
  readonly platformBaseDir?: string;
}

export interface RuntimePaths {
  readonly baseDir: string;
  readonly configFile: string;
  readonly dataDir: string;
  readonly logDir: string;
  readonly backupDir: string;
  readonly distDir: string;
  readonly managedBinDir: string;
  readonly repositoryBinDir?: string;
  readonly pathDirectories: readonly string[];
  managedPath(relativePath: string): string;
  binaryCandidates(name: string): readonly string[];
}

function containedPath(baseDir: string, relativePath: string): string {
  const candidate = resolve(baseDir, relativePath);
  if (candidate !== baseDir && !candidate.startsWith(`${baseDir}${sep}`)) {
    throw new Error(`Path escapes the MioBridge runtime directory: ${relativePath}`);
  }
  return candidate;
}

export function createRuntimePaths(options: RuntimePathsOptions = {}): RuntimePaths {
  const env = options.env ?? process.env;
  const baseDir = resolve(
    env.MIOBRIDGE_CONFIG_DIR
      ?? options.platformBaseDir
      ?? join(options.homeDir ?? homedir(), '.config', 'miobridge'),
  );
  const applicationRoot = options.applicationRoot ? resolve(options.applicationRoot) : undefined;
  const managedBinDir = containedPath(baseDir, 'bin');
  const repositoryBinDir = applicationRoot ? join(applicationRoot, 'bin') : undefined;
  const pathDirectories = (env.PATH ?? '').split(delimiter).filter(Boolean);

  return Object.freeze({
    baseDir,
    configFile: containedPath(baseDir, 'config.yaml'),
    dataDir: containedPath(baseDir, 'www'),
    logDir: containedPath(baseDir, 'log'),
    backupDir: containedPath(baseDir, 'backup'),
    distDir: containedPath(baseDir, 'dist'),
    managedBinDir,
    ...(repositoryBinDir ? { repositoryBinDir } : {}),
    pathDirectories,
    managedPath(relativePath: string) {
      return containedPath(baseDir, relativePath);
    },
    binaryCandidates(name: string) {
      if (!name || name.includes('/') || name.includes('\\')) {
        throw new Error(`Invalid binary name: ${name}`);
      }
      return [
        join(managedBinDir, name),
        ...(repositoryBinDir ? [join(repositoryBinDir, name)] : []),
        ...pathDirectories.map(directory => join(directory, name)),
      ];
    },
  });
}
