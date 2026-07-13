import type { ArtifactCatalog } from './types.js';

// Versions and digests are deliberately immutable. Updating a dependency is a reviewed source change.
export const PINNED_ARTIFACTS: ArtifactCatalog = {
  mihomo: {
    x64: { version: 'v1.19.12', url: 'https://github.com/MetaCubeX/mihomo/releases/download/v1.19.12/mihomo-linux-amd64-v1.19.12.gz', sha256: 'ab666e6e7feec707836d0858bd9955343a82e119108e6c4399269c678e5c6303', archive: 'gzip', versionArgs: ['-v'] },
    arm64: { version: 'v1.19.12', url: 'https://github.com/MetaCubeX/mihomo/releases/download/v1.19.12/mihomo-linux-arm64-v1.19.12.gz', sha256: 'fcb9e294f492eb9df9bca4e1f9c66a383f5e8eef1da7cd20ae5ac3d093fdaaf1', archive: 'gzip', versionArgs: ['-v'] },
  },
  bun: {
    x64: { version: '1.2.20', url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.2.20/bun-linux-x64.zip', sha256: '4e9edc4cba0c7c1623a288be01e53bbde11a4d073f2cf339cab026627858b548', archive: 'zip', entry: 'bun-linux-x64/bun', versionArgs: ['--version'] },
    arm64: { version: '1.2.20', url: 'https://github.com/oven-sh/bun/releases/download/bun-v1.2.20/bun-linux-aarch64.zip', sha256: '98d2e0b2c09421569172b4d46b6f81378c2dbdd77480ebb27f3989dd4e72e18b', archive: 'zip', entry: 'bun-linux-aarch64/bun', versionArgs: ['--version'] },
  },
  yq: {
    x64: { version: 'v4.47.1', url: 'https://github.com/mikefarah/yq/releases/download/v4.47.1/yq_linux_amd64', sha256: '0fb28c6680193c41b364193d0c0fc4a03177aecde51cfc04d506b1517158c2fb', archive: 'binary', versionArgs: ['--version'] },
    arm64: { version: 'v4.47.1', url: 'https://github.com/mikefarah/yq/releases/download/v4.47.1/yq_linux_arm64', sha256: 'b7f7c991abe262b0c6f96bbcb362f8b35429cefd59c8b4c2daa4811f1e9df599', archive: 'binary', versionArgs: ['--version'] },
  },
};
