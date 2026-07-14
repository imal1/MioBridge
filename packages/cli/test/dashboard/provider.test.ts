import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { loadDashboardProvider, validateDashboardProviderManifest } from '../../src/index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

function v2Manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    dashboardVersion: '2.0.0',
    artifactRoot: 'dist',
    reservedPaths: [],
    ...overrides,
  };
}

describe('dashboard provider manifest', () => {
  it('validates v2 provider contract', () => {
    const m = validateDashboardProviderManifest(v2Manifest());
    expect(m).toMatchObject({ schemaVersion: 2, artifactRoot: 'dist' });
    // v2 auto-adds reserved paths
    expect('reservedPaths' in m).toBe(true);
  });

  it('rejects obsolete provider schemas', () => {
    expect(() => validateDashboardProviderManifest(v2Manifest({ schemaVersion: 3 }))).toThrow('Unsupported dashboard provider schema');
  });

  it('rejects v2 with escape path', () => {
    expect(() => validateDashboardProviderManifest(v2Manifest({ artifactRoot: '../outside' }))).toThrow('inside the provider root');
  });

  it('reports missing providers with installation guidance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miobridge-provider-'));
    roots.push(root);
    await expect(loadDashboardProvider(join(root, 'provider.json'))).rejects.toThrow('Install a dashboard provider first');
  });

  it('loads v2 provider with valid artifact root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miobridge-provider-v2-'));
    roots.push(root);
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'provider.json'), JSON.stringify(v2Manifest()));
    const result = await loadDashboardProvider(join(root, 'provider.json'));
    expect(result.manifest.schemaVersion).toBe(2);
    expect(result.manifest.artifactRoot).toBe('dist');
  });
});
