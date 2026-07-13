export type LinuxArchitecture = 'x64' | 'arm64';

export interface LinuxPlatform {
  readonly os: 'linux';
  readonly architecture: LinuxArchitecture;
  readonly distro: string;
}

export function detectLinuxPlatform(input: { readonly platform: string; readonly architecture: string; readonly osRelease?: string }): LinuxPlatform {
  if (input.platform !== 'linux') throw new Error(`Unsupported operating system: ${input.platform}. MioBridge supports Linux only.`);
  const architecture = input.architecture === 'x64' || input.architecture === 'amd64'
    ? 'x64'
    : input.architecture === 'arm64' || input.architecture === 'aarch64'
      ? 'arm64'
      : null;
  if (!architecture) throw new Error(`Unsupported Linux architecture: ${input.architecture}. Supported architectures: x64, arm64.`);
  const distro = /^ID=(?:"([^"]+)"|([^\n]+))/m.exec(input.osRelease ?? '')?.slice(1).find(Boolean)?.trim() ?? 'unknown';
  return { os: 'linux', architecture, distro };
}
