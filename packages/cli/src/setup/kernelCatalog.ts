import type { KernelType } from '@miobridge/core';
import type { Artifact } from './types.js';

type KernelArtifactCatalog = Readonly<Record<KernelType, Readonly<Record<'x64' | 'arm64', Artifact>>>>;

// Official upstream release artifacts. Versions and SHA-256 digests are pinned
// so a dashboard deployment cannot execute an unreviewed installer script.
export const PINNED_KERNEL_ARTIFACTS: KernelArtifactCatalog = {
  'sing-box': {
    x64: {
      version: 'v1.13.14',
      url: 'https://github.com/SagerNet/sing-box/releases/download/v1.13.14/sing-box-1.13.14-linux-amd64.tar.gz',
      sha256: 'f48703461a15476951ac4967cdad339d986f4b8096b4eb3ff0829a500502d697',
      archive: 'tar-gzip',
      entry: 'sing-box-1.13.14-linux-amd64/sing-box',
      versionArgs: ['version'],
    },
    arm64: {
      version: 'v1.13.14',
      url: 'https://github.com/SagerNet/sing-box/releases/download/v1.13.14/sing-box-1.13.14-linux-arm64.tar.gz',
      sha256: '4742df6a4314e8ecc41736849fca6d73b8f9e91b6e8b06ee794ff17ba180579e',
      archive: 'tar-gzip',
      entry: 'sing-box-1.13.14-linux-arm64/sing-box',
      versionArgs: ['version'],
    },
  },
  xray: {
    x64: {
      version: 'v26.3.27',
      url: 'https://github.com/XTLS/Xray-core/releases/download/v26.3.27/Xray-linux-64.zip',
      sha256: '23cd9af937744d97776ee35ecad4972cf4b2109d1e0fe6be9930467608f7c8ae',
      archive: 'zip',
      entry: 'xray',
      versionArgs: ['version'],
    },
    arm64: {
      version: 'v26.3.27',
      url: 'https://github.com/XTLS/Xray-core/releases/download/v26.3.27/Xray-linux-arm64-v8a.zip',
      sha256: '4d30283ae614e3057f730f67cd088a42be6fdf91f8639d82cb69e48cde80413c',
      archive: 'zip',
      entry: 'xray',
      versionArgs: ['version'],
    },
  },
  v2ray: {
    x64: {
      version: 'v5.51.2',
      url: 'https://github.com/v2fly/v2ray-core/releases/download/v5.51.2/v2ray-linux-64.zip',
      sha256: '7d034da48fb445fe0acd477ffc8fa9712c68cdf02f1431e3ed9c54c10bf81db3',
      archive: 'zip',
      entry: 'v2ray',
      versionArgs: ['version'],
    },
    arm64: {
      version: 'v5.51.2',
      url: 'https://github.com/v2fly/v2ray-core/releases/download/v5.51.2/v2ray-linux-arm64-v8a.zip',
      sha256: '0fd8a6cee265e2245b7aff460176056f9777b2e47d5b0680e3e635d827340485',
      archive: 'zip',
      entry: 'v2ray',
      versionArgs: ['version'],
    },
  },
};
