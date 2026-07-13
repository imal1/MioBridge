import type { RuntimePaths } from '@miobridge/core';
import type { LinuxPlatform } from '../platform/linux.js';

export type DependencyName = 'mihomo' | 'bun' | 'yq' | 'sing-box';
export type DependencyOrigin = 'configured' | 'managed' | 'PATH' | 'missing';

export interface DependencyStatus {
  readonly name: DependencyName;
  readonly required: boolean;
  readonly capability: string;
  readonly origin: DependencyOrigin;
  readonly path?: string;
  readonly version?: string;
  readonly installed?: boolean;
}

export interface Artifact {
  readonly version: string;
  readonly url: string;
  readonly sha256: string;
  readonly archive: 'binary' | 'gzip' | 'zip';
  readonly entry?: string;
  readonly versionArgs: readonly string[];
}

export interface SetupAdapters {
  readonly platform: () => Promise<LinuxPlatform>;
  readonly existsExecutable: (path: string) => Promise<boolean>;
  readonly probeVersion: (path: string, args: readonly string[]) => Promise<string>;
  readonly confirm: (message: string) => Promise<boolean>;
  readonly download: (url: string) => Promise<Uint8Array>;
  readonly sha256: (data: Uint8Array) => Promise<string>;
  readonly extract: (data: Uint8Array, artifact: Artifact) => Promise<Uint8Array>;
  readonly installAtomic: (path: string, data: Uint8Array, validate: (temporaryPath: string) => Promise<void>) => Promise<void>;
}

export interface SetupOptions {
  readonly paths: RuntimePaths;
  readonly configured?: Partial<Record<DependencyName, string>>;
  readonly adapters: SetupAdapters;
  readonly artifacts?: ArtifactCatalog;
}

export type ArtifactCatalog = Readonly<Record<Exclude<DependencyName, 'sing-box'>, Readonly<Record<'x64' | 'arm64', Artifact>>>>;
