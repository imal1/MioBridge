import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const repoRoot = path.resolve(import.meta.dirname, '..');
const outputPath = path.join(repoRoot, 'frontend', 'bin', 'mihomo');
const version = process.env.MIOBRIDGE_MIHOMO_VERSION || 'latest';
const directUrl = process.env.MIOBRIDGE_MIHOMO_DOWNLOAD_URL || '';

function githubHeaders() {
  return {
    'User-Agent': 'miobridge-build',
    'Accept': 'application/vnd.github+json',
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  };
}

function selectAsset(assets) {
  const arch = process.arch;
  const platform = process.platform;
  if (platform !== 'linux') {
    throw new Error(`mihomo build binary is only downloaded for linux, got ${platform}/${arch}`);
  }

  const patterns = arch === 'x64'
    ? [/mihomo-linux-amd64-v1-v[\d.]+\.gz$/, /mihomo-linux-amd64-compatible-v[\d.]+\.gz$/, /mihomo-linux-amd64-v[\d.]+\.gz$/]
    : arch === 'arm64'
      ? [/mihomo-linux-arm64-v[\d.]+\.gz$/]
      : [];

  for (const pattern of patterns) {
    const asset = assets.find(item => pattern.test(item.name));
    if (asset) return asset;
  }

  throw new Error(`No mihomo linux asset found for ${platform}/${arch}`);
}

async function resolveDownload() {
  if (directUrl) {
    return {
      name: path.basename(new URL(directUrl).pathname),
      url: directUrl,
    };
  }

  const releaseUrl = version === 'latest'
    ? 'https://api.github.com/repos/MetaCubeX/mihomo/releases/latest'
    : `https://api.github.com/repos/MetaCubeX/mihomo/releases/tags/${encodeURIComponent(version)}`;
  const response = await fetch(releaseUrl, { headers: githubHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to fetch mihomo release: HTTP ${response.status}`);
  }

  const release = await response.json();
  const asset = selectAsset(release.assets || []);
  return { name: asset.name, url: asset.browser_download_url };
}

async function main() {
  if (process.platform !== 'linux') {
    console.log(`[mihomo] Skipping download on ${process.platform}; Vercel will download during linux build.`);
    return;
  }

  const existing = await fs.stat(outputPath).catch(() => null);
  if (existing?.size > 0 && !process.env.MIOBRIDGE_FORCE_MIHOMO_DOWNLOAD) {
    console.log(`[mihomo] Using existing ${outputPath}`);
    return;
  }

  const asset = await resolveDownload();
  console.log(`[mihomo] Downloading ${asset.name}`);
  const binaryResponse = await fetch(asset.url, { headers: githubHeaders() });
  if (!binaryResponse.ok) {
    throw new Error(`Failed to download mihomo: HTTP ${binaryResponse.status}`);
  }

  const compressed = Buffer.from(await binaryResponse.arrayBuffer());
  const binary = asset.name.endsWith('.gz') ? zlib.gunzipSync(compressed) : compressed;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, binary, { mode: 0o755 });
  await fs.chmod(outputPath, 0o755);
  console.log(`[mihomo] Wrote ${outputPath} (${binary.length} bytes)`);
}

main().catch(error => {
  console.error(`[mihomo] ${error.message}`);
  process.exit(1);
});
