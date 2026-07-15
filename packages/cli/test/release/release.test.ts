import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');
const packageScript = join(root, 'scripts/package-cli-release.sh');
const installer = join(root, 'scripts/install.sh');
const temporaryRoots = new Set<string>();

function temporary(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.add(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryRoots) rmSync(path, { recursive: true, force: true });
  temporaryRoots.clear();
});

function fixture() {
  const dir = temporary('miobridge-release-test-');
  const binaries = join(dir, 'binaries');
  const release = join(dir, 'release');
  mkdirSync(binaries);
  mkdirSync(release);
  const provider = join(dir, 'provider');
  mkdirSync(join(provider, 'artifact'), { recursive: true });
  writeFileSync(join(provider, 'provider.json'), '{"schemaVersion":2,"dashboardVersion":"test","artifactRoot":"artifact","reservedPaths":[]}\n');
  writeFileSync(join(provider, 'artifact', 'index.html'), '<main>MioBridge</main>\n');
  for (const arch of ['x64', 'arm64']) {
    const file = join(binaries, arch);
    writeFileSync(file, `#!/bin/sh\necho ${arch}-v1\n`);
    chmodSync(file, 0o755);
    const agent = join(binaries, `agent-${arch}`);
    writeFileSync(agent, '#!/bin/sh\necho 1.2.3\n');
    chmodSync(agent, 0o755);
  }
  execFileSync('bash', [packageScript, '1.2.3'], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      MIOBRIDGE_RELEASE_DIR: release,
      MIOBRIDGE_BINARY_X64: join(binaries, 'x64'),
      MIOBRIDGE_BINARY_ARM64: join(binaries, 'arm64'),
      MIOBRIDGE_AGENT_BINARY_X64: join(binaries, 'agent-x64'),
      MIOBRIDGE_AGENT_BINARY_ARM64: join(binaries, 'agent-arm64'),
      MIOBRIDGE_DASHBOARD_PROVIDER_DIR: provider,
    },
  });
  return { dir, release };
}

function fakePlatform(dir: string, machine: string) {
  const bin = join(dir, 'fake-bin');
  mkdirSync(bin);
  const uname = join(bin, 'uname');
  writeFileSync(uname, `#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo ${machine};; *) echo Linux;; esac\n`);
  chmodSync(uname, 0o755);
  return `${bin}:${process.env.PATH}`;
}

describe('CLI release distribution', () => {
  it('cleans and rebuilds core before compiling release sources', () => {
    const sandbox = temporary('miobridge-release-clean-');
    const sandboxScript = join(sandbox, 'scripts', 'package-cli-release.sh');
    const coreDir = join(sandbox, 'packages', 'core');
    const log = join(sandbox, 'bun.log');
    const fakeBun = join(sandbox, 'bun');
    const release = join(sandbox, 'release');
    const provider = join(sandbox, 'provider');
    mkdirSync(join(sandbox, 'scripts'), { recursive: true });
    mkdirSync(join(coreDir, 'dist'), { recursive: true });
    mkdirSync(join(sandbox, 'packages', 'cli', 'src'), { recursive: true });
    mkdirSync(join(provider, 'artifact'), { recursive: true });
    writeFileSync(join(provider, 'provider.json'), '{"schemaVersion":2,"dashboardVersion":"test","artifactRoot":"artifact","reservedPaths":[]}\n');
    writeFileSync(join(provider, 'artifact', 'index.html'), '<main>MioBridge</main>\n');
    writeFileSync(join(coreDir, 'dist', 'stale.js'), 'stale');
    writeFileSync(join(sandbox, 'packages', 'cli', 'src', 'main.ts'), 'fixture');
    copyFileSync(packageScript, sandboxScript);
    writeFileSync(fakeBun, [
      '#!/bin/sh',
      'set -eu',
      'printf "%s\\n" "$*" >> "$FAKE_BUN_LOG"',
      'if [ "$1" = run ]; then',
      '  test ! -e "$3/dist/stale.js"',
      '  mkdir -p "$3/dist"',
      '  printf fresh > "$3/dist/index.js"',
      '  exit 0',
      'fi',
      'while [ "$#" -gt 0 ]; do',
      '  if [ "$1" = --outfile ]; then',
      '    shift',
      '    printf "#!/bin/sh\\nexit 0\\n" > "$1"',
      '    chmod 755 "$1"',
      '    exit 0',
      '  fi',
      '  shift',
      'done',
      'exit 1',
      '',
    ].join('\n'));
    chmodSync(fakeBun, 0o755);
    execFileSync('bash', [sandboxScript, '1.2.4'], {
      env: { ...process.env, FAKE_BUN_LOG: log, MIOBRIDGE_BUN_CMD: fakeBun, MIOBRIDGE_RELEASE_DIR: release, MIOBRIDGE_DASHBOARD_PROVIDER_DIR: provider },
    });
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
      `run --cwd ${coreDir} build`,
      expect.stringContaining(`build ${join(sandbox, 'packages', 'cli', 'src', 'main.ts')} --compile --target=bun-linux-x64`),
      expect.stringContaining(`build ${join(sandbox, 'packages', 'cli', 'src', 'main.ts')} --compile --target=bun-linux-arm64`),
      expect.stringContaining(`build ${join(sandbox, 'agent', 'src', 'server.ts')} --compile --target=bun-linux-x64`),
      expect.stringContaining(`build ${join(sandbox, 'agent', 'src', 'server.ts')} --compile --target=bun-linux-arm64`),
    ]);
    expect(readFileSync(join(coreDir, 'dist', 'index.js'), 'utf8')).toBe('fresh');
  });

  it('packages deterministic architecture names, checksums, and executable binaries', () => {
    const { release } = fixture();
    const sums = readFileSync(join(release, 'SHA256SUMS'), 'utf8');
    for (const arch of ['x64', 'arm64']) {
      const archive = `miobridge-1.2.3-linux-${arch}.tar.gz`;
      expect(sums).toContain(archive);
      const listing = execFileSync('tar', ['-tvzf', join(release, archive)], { encoding: 'utf8' });
      const binaryLine = listing.split('\n').find((line) => line.endsWith(' miobridge'));
      expect(binaryLine?.startsWith('-rwx')).toBe(true);
      expect(statSync(join(release, `miobridge-agent-1.2.3-linux-${arch}.gz`)).size).toBeGreaterThan(0);
    }
  });

  it.each([['x86_64', 'x64'], ['aarch64', 'arm64']])('maps %s and installs from an external cwd', (machine, expected) => {
    const { dir, release } = fixture();
    const installDir = join(dir, 'installed');
    const cwd = join(dir, 'external');
    mkdirSync(cwd);
    const output = execFileSync('sh', [installer, '--version', '1.2.3', '--base-url', `file://${release}`, '--install-dir', installDir], {
      cwd,
      env: { ...process.env, HOME: dir, PATH: fakePlatform(dir, machine) },
      encoding: 'utf8',
    });
    expect(output).toContain('Installing required runtime dependencies through the CLI');
    expect(execFileSync(join(installDir, 'miobridge'), { encoding: 'utf8' }).trim()).toBe(`${expected}-v1`);
    expect(statSync(join(installDir, 'miobridge')).mode & 0o111).not.toBe(0);
    expect(readFileSync(join(dir, '.config/miobridge/dist/dashboard/artifact/index.html'), 'utf8')).toContain('MioBridge');
  });

  it('rejects a bad checksum without replacing the installed version', () => {
    const { dir, release } = fixture();
    const installDir = join(dir, 'installed');
    mkdirSync(installDir);
    const binary = join(installDir, 'miobridge');
    writeFileSync(binary, '#!/bin/sh\necho previous\n');
    chmodSync(binary, 0o755);
    writeFileSync(join(release, 'SHA256SUMS'), `0000000000000000000000000000000000000000000000000000000000000000  miobridge-1.2.3-linux-x64.tar.gz\n`);
    const result = spawnSync('sh', [installer, '--version', '1.2.3', '--base-url', `file://${release}`, '--install-dir', installDir, '--skip-setup'], {
      cwd: tmpdir(), env: { ...process.env, PATH: fakePlatform(dir, 'x86_64') }, encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('checksum verification failed');
    expect(execFileSync(binary, { encoding: 'utf8' }).trim()).toBe('previous');
  });

  it('replaces only CLI-owned files and preserves user configuration', () => {
    const { dir } = fixture();
    const installDir = join(dir, 'installed');
    const configDir = join(dir, '.config/miobridge');
    mkdirSync(installDir);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(installDir, 'miobridge'), 'owned');
    writeFileSync(join(installDir, '.miobridge-cli-version'), '1.2.3\n');
    writeFileSync(join(configDir, 'config.yaml'), 'preserve: true\n');
    const { release } = fixture();
    execFileSync('sh', [installer, '--version', '1.2.3', '--base-url', `file://${release}`, '--install-dir', installDir, '--skip-setup'], {
      env: { ...process.env, HOME: dir, PATH: fakePlatform(dir, 'x86_64') },
    });
    expect(readFileSync(join(configDir, 'config.yaml'), 'utf8')).toContain('preserve');
    expect(execFileSync(join(installDir, 'miobridge'), { encoding: 'utf8' }).trim()).toBe('x64-v1');
  });
});
