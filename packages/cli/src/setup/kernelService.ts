import { join } from 'node:path';
import type { KernelType, RuntimePaths } from '@miobridge/core';
import { PINNED_KERNEL_ARTIFACTS } from './kernelCatalog.js';
import type { SetupAdapters } from './types.js';

export interface LocalKernelInstallResult {
  readonly type: KernelType;
  readonly path: string;
  readonly version: string;
  readonly installed: boolean;
}

export interface LocalKernelInstaller {
  ensure(type: KernelType): Promise<LocalKernelInstallResult>;
}

export class LocalKernelInstallationService implements LocalKernelInstaller {
  constructor(private readonly paths: RuntimePaths, private readonly adapters: SetupAdapters) {}

  async ensure(type: KernelType): Promise<LocalKernelInstallResult> {
    const platform = await this.adapters.platform();
    const artifact = PINNED_KERNEL_ARTIFACTS[type][platform.architecture];
    for (const candidate of this.paths.binaryCandidates(type)) {
      if (!await this.adapters.existsExecutable(candidate)) continue;
      try {
        const version = await this.adapters.probeVersion(candidate, artifact.versionArgs);
        return { type, path: candidate, version, installed: false };
      } catch { /* A broken executable is replaced by the pinned artifact. */ }
    }

    const downloaded = await this.adapters.download(artifact.url);
    const digest = await this.adapters.sha256(downloaded);
    if (digest.toLowerCase() !== artifact.sha256.toLowerCase()) throw new Error(`${type} 下载文件校验失败`);
    const binary = await this.adapters.extract(downloaded, artifact);
    const target = join(this.paths.managedBinDir, type);
    await this.adapters.installAtomic(target, binary, async temporaryPath => {
      const version = await this.adapters.probeVersion(temporaryPath, artifact.versionArgs);
      const expected = artifact.version.replace(/^v/, '');
      if (!version.includes(expected)) throw new Error(`${type} 版本校验失败：预期 ${expected}`);
    });
    return { type, path: target, version: artifact.version, installed: true };
  }
}
