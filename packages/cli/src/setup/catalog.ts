import type { ArtifactCatalog } from './types.js';

// Versions and digests are deliberately immutable. Updating a dependency is a reviewed source change.
export const PINNED_ARTIFACTS: ArtifactCatalog = {
  mihomo: {
    x64: { version: 'v1.19.12', url: 'https://github.com/MetaCubeX/mihomo/releases/download/v1.19.12/mihomo-linux-amd64-v1.19.12.gz', sha256: 'ab666e6e7feec707836d0858bd9955343a82e119108e6c4399269c678e5c6303', archive: 'gzip', versionArgs: ['-v'] },
    arm64: { version: 'v1.19.12', url: 'https://github.com/MetaCubeX/mihomo/releases/download/v1.19.12/mihomo-linux-arm64-v1.19.12.gz', sha256: 'fcb9e294f492eb9df9bca4e1f9c66a383f5e8eef1da7cd20ae5ac3d093fdaaf1', archive: 'gzip', versionArgs: ['-v'] },
  },
};
