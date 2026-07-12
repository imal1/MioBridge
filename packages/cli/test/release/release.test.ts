import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');
const packageScript = join(root, 'scripts/package-cli-release.sh');
const installer = join(root, 'scripts/install-cli.sh');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'miobridge-release-test-'));
  const binaries = join(dir, 'binaries');
  const release = join(dir, 'release');
  mkdirSync(binaries);
  mkdirSync(release);
  for (const arch of ['x64', 'arm64']) {
    const file = join(binaries, arch);
    writeFileSync(file, `#!/bin/sh\necho ${arch}-v1\n`);
    chmodSync(file, 0o755);
  }
  execFileSync('bash', [packageScript, '1.2.3'], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      MIOBRIDGE_RELEASE_DIR: release,
      MIOBRIDGE_BINARY_X64: join(binaries, 'x64'),
      MIOBRIDGE_BINARY_ARM64: join(binaries, 'arm64'),
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
  it('packages deterministic architecture names, checksums, and executable binaries', () => {
    const { release } = fixture();
    const sums = readFileSync(join(release, 'SHA256SUMS'), 'utf8');
    for (const arch of ['x64', 'arm64']) {
      const archive = `miobridge-1.2.3-linux-${arch}.tar.gz`;
      expect(sums).toContain(archive);
      const listing = execFileSync('tar', ['-tvzf', join(release, archive)], { encoding: 'utf8' });
      const binaryLine = listing.split('\n').find((line) => line.endsWith(' miobridge'));
      expect(binaryLine?.startsWith('-rwx')).toBe(true);
    }
  });

  it.each([['x86_64', 'x64'], ['aarch64', 'arm64']])('maps %s and installs from an external cwd', (machine, expected) => {
    const { dir, release } = fixture();
    const installDir = join(dir, 'installed');
    const cwd = join(dir, 'external');
    mkdirSync(cwd);
    execFileSync('sh', [installer, '--version', '1.2.3', '--base-url', `file://${release}`, '--install-dir', installDir], {
      cwd,
      env: { ...process.env, PATH: fakePlatform(dir, machine) },
    });
    expect(execFileSync(join(installDir, 'miobridge'), { encoding: 'utf8' }).trim()).toBe(`${expected}-v1`);
    expect(statSync(join(installDir, 'miobridge')).mode & 0o111).not.toBe(0);
  });

  it('rejects a bad checksum without replacing the installed version', () => {
    const { dir, release } = fixture();
    const installDir = join(dir, 'installed');
    mkdirSync(installDir);
    const binary = join(installDir, 'miobridge');
    writeFileSync(binary, '#!/bin/sh\necho previous\n');
    chmodSync(binary, 0o755);
    writeFileSync(join(release, 'SHA256SUMS'), `0000000000000000000000000000000000000000000000000000000000000000  miobridge-1.2.3-linux-x64.tar.gz\n`);
    const result = spawnSync('sh', [installer, '--version', '1.2.3', '--base-url', `file://${release}`, '--install-dir', installDir], {
      cwd: tmpdir(), env: { ...process.env, PATH: fakePlatform(dir, 'x86_64') }, encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('checksum verification failed');
    expect(execFileSync(binary, { encoding: 'utf8' }).trim()).toBe('previous');
  });

  it('uninstalls only CLI-owned files and preserves user configuration', () => {
    const { dir } = fixture();
    const installDir = join(dir, 'installed');
    const configDir = join(dir, '.config/miobridge');
    mkdirSync(installDir);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(installDir, 'miobridge'), 'owned');
    writeFileSync(join(installDir, '.miobridge-cli-version'), '1.2.3\n');
    writeFileSync(join(configDir, 'config.yaml'), 'preserve: true\n');
    execFileSync('sh', [installer, '--uninstall', '--install-dir', installDir], { env: { ...process.env, HOME: dir } });
    expect(readFileSync(join(configDir, 'config.yaml'), 'utf8')).toContain('preserve');
    expect(() => statSync(join(installDir, 'miobridge'))).toThrow();
  });
});
