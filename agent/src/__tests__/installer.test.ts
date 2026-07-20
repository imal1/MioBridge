import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');
const installer = join(root, 'scripts', 'install-agent.sh');
const temporaryRoots = new Set<string>();

function temporary(): string {
  const directory = mkdtempSync(join(tmpdir(), 'miobridge-agent-installer-'));
  temporaryRoots.add(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryRoots) rmSync(directory, { recursive: true, force: true });
  temporaryRoots.clear();
});

function writeAgentRelease(release: string, marker = 'initial'): void {
  mkdirSync(release, { recursive: true });
  const source = join(release, 'agent');
  writeFileSync(source, [
    '#!/bin/sh',
    'case "$1" in',
    '  --version) echo 1.2.3 ;;',
    '  --check-config) grep -q "^node:" "$2" && grep -q "secret:" "$2" ;;',
    `  --marker) echo ${marker} ;;`,
    '  *) exit 0 ;;',
    'esac',
    '',
  ].join('\n'));
  chmodSync(source, 0o755);
  for (const architecture of ['x64', 'arm64']) {
    writeFileSync(
      join(release, `miobridge-agent-1.2.3-linux-${architecture}.gz`),
      execFileSync('gzip', ['-n', '-c', source]),
    );
  }
  const sums = execFileSync('shasum', [
    '-a', '256',
    join(release, 'miobridge-agent-1.2.3-linux-x64.gz'),
    join(release, 'miobridge-agent-1.2.3-linux-arm64.gz'),
  ], { encoding: 'utf8' }).replaceAll(`${release}/`, '');
  writeFileSync(join(release, 'SHA256SUMS'), sums);
}

function fixture(machine = 'x86_64') {
  const directory = temporary();
  const release = join(directory, 'release');
  const fakeBin = join(directory, 'fake-bin');
  const installDir = join(directory, 'bin');
  const configDir = join(directory, 'config');
  const unitPath = join(directory, 'systemd', 'miobridge-agent.service');
  const active = join(directory, 'active');
  const failRestart = join(directory, 'fail-restart');
  const systemctlLog = join(directory, 'systemctl.log');
  mkdirSync(fakeBin);
  writeAgentRelease(release);
  writeFileSync(join(fakeBin, 'uname'), `#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo ${machine};; *) echo Linux;; esac\n`);
  writeFileSync(join(fakeBin, 'systemctl'), [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$FAKE_SYSTEMCTL_LOG"',
    '[ "$1" != "--user" ] || shift',
    'case "$1" in',
    '  is-active) test -f "$FAKE_ACTIVE" ;;',
    '  restart) test ! -f "$FAKE_FAIL_RESTART" || exit 1; touch "$FAKE_ACTIVE" ;;',
    '  stop) rm -f "$FAKE_ACTIVE" ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'));
  writeFileSync(join(fakeBin, 'curl'), [
    '#!/bin/sh',
    'destination=',
    'url=',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    -o) destination=$2; shift 2; continue ;;',
    '    http://127.0.0.1:*/health) exit 0 ;;',
    '    https://api.github.com/*) printf "{\\"tag_name\\":\\"v1.2.3\\"}\\n"; exit 0 ;;',
    '    file://*|https://github.com/*) url=$1 ;;',
    '  esac',
    '  shift',
    'done',
    '[ -n "$url" ] || exit 1',
    'case "$url" in file://*) source=${url#file://} ;; *) source="$FAKE_RELEASE/${url##*/}" ;; esac',
    'cp "$source" "$destination"',
    '',
  ].join('\n'));
  for (const file of ['uname', 'systemctl', 'curl']) chmodSync(join(fakeBin, file), 0o755);
  const config = join(directory, 'agent.yaml');
  writeFileSync(config, 'node:\n  id: "node-1"\n  name: "Child"\n  secret: "secret"\nkernels: []\nport: 3001\n');
  const env = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    MIOBRIDGE_AGENT_UNIT_PATH: unitPath,
    MIOBRIDGE_AGENT_SYSTEMCTL: 'systemctl',
    FAKE_SYSTEMCTL_LOG: systemctlLog,
    FAKE_ACTIVE: active,
    FAKE_FAIL_RESTART: failRestart,
    FAKE_RELEASE: release,
  };
  return { directory, release, installDir, configDir, unitPath, active, failRestart, systemctlLog, config, env };
}

function installArgs(context: ReturnType<typeof fixture>, extra: string[] = []): string[] {
  return [
    installer,
    '--version', '1.2.3',
    '--base-url', `file://${context.release}`,
    '--install-dir', context.installDir,
    '--config-dir', context.configDir,
    ...extra,
  ];
}

describe('install-agent.sh', () => {
  test('uses current-user binary, config, and user systemd paths by default', () => {
    const context = fixture();
    const userHome = join(context.directory, 'home');
    const xdgConfig = join(context.directory, 'xdg');
    const { MIOBRIDGE_AGENT_UNIT_PATH: _unitPath, ...env } = context.env;
    execFileSync('sh', [
      installer,
      '--version', '1.2.3',
      '--base-url', `file://${context.release}`,
      '--config', context.config,
    ], { env: { ...env, HOME: userHome, XDG_CONFIG_HOME: xdgConfig } });

    expect(execFileSync(join(userHome, '.local', 'bin', 'miobridge-agent'), ['--version'], { encoding: 'utf8' }).trim()).toBe('1.2.3');
    expect(readFileSync(join(userHome, '.config', 'miobridge-agent', 'agent.yaml'), 'utf8')).toContain('id: "node-1"');
    expect(readFileSync(join(xdgConfig, 'systemd', 'user', 'miobridge-agent.service'), 'utf8')).toContain('WantedBy=default.target');
  });

  test.each([['x86_64', 'x64'], ['amd64', 'x64'], ['aarch64', 'arm64'], ['arm64', 'arm64']])(
    'maps %s to the %s release and installs an explicit-config systemd unit',
    (machine) => {
      const context = fixture(machine);
      const output = execFileSync('sh', installArgs(context, ['--config', context.config]), {
        env: context.env,
        encoding: 'utf8',
      });
      const binary = join(context.installDir, 'miobridge-agent');
      expect(output).toContain('MioBridge Agent 1.2.3 installed');
      expect(execFileSync(binary, ['--marker'], { encoding: 'utf8' }).trim()).toBe('initial');
      const unit = readFileSync(context.unitPath, 'utf8');
      expect(unit).toContain(`ExecStart=${binary} --config ${join(context.configDir, 'agent.yaml')}`);
      expect(unit).toContain(`WorkingDirectory=${context.configDir}`);
      expect(unit).not.toContain('WorkingDirectory="');
      expect(unit).toContain('WantedBy=default.target');
      expect(readFileSync(context.systemctlLog, 'utf8')).toContain('--user daemon-reload');
      expect(readFileSync(context.systemctlLog, 'utf8')).toContain('--user restart miobridge-agent');
    },
  );

  test('resolves the latest GitHub release and is idempotent for the same version', () => {
    const context = fixture();
    const args = [
      installer,
      '--install-dir', context.installDir,
      '--config-dir', context.configDir,
      '--config', context.config,
    ];
    execFileSync('sh', args, { env: context.env });
    execFileSync('sh', args, { env: context.env });
    expect(execFileSync(join(context.installDir, 'miobridge-agent'), ['--version'], { encoding: 'utf8' }).trim()).toBe('1.2.3');
  });

  test('generates kernels: [] from independent parameters and never accepts a plaintext secret option', () => {
    const context = fixture();
    const secret = join(context.directory, 'secret');
    writeFileSync(secret, 'manual-secret\n');
    execFileSync('sh', installArgs(context, [
      '--node-id', 'node-manual',
      '--node-name', 'Manual Child',
      '--secret-file', secret,
      '--port', '3010',
    ]), { env: context.env });
    const generated = readFileSync(join(context.configDir, 'agent.yaml'), 'utf8');
    expect(generated).toContain('id: "node-manual"');
    expect(generated).toContain('secret: "manual-secret"');
    expect(generated).toContain('kernels: []');
    expect(generated).toContain('port: 3010');

    const rejected = spawnSync('sh', installArgs(context, ['--secret', 'plaintext']), { env: context.env, encoding: 'utf8' });
    expect(rejected.status).toBe(2);
    expect(rejected.stderr).toContain('--secret is not supported');
  });

  test('rejects first install without configuration and rejects a missing checksum entry', () => {
    const context = fixture();
    const missingConfig = spawnSync('sh', installArgs(context), { env: context.env, encoding: 'utf8' });
    expect(missingConfig.status).toBe(2);
    expect(missingConfig.stderr).toContain('first Agent installation requires');

    writeFileSync(join(context.release, 'SHA256SUMS'), '0  unrelated.gz\n');
    const missingChecksum = spawnSync('sh', installArgs(context, ['--config', context.config]), { env: context.env, encoding: 'utf8' });
    expect(missingChecksum.status).toBe(1);
    expect(missingChecksum.stderr).toContain('checksum entry missing');
  });

  test('restores binary, config, and unit when systemd restart fails', () => {
    const context = fixture();
    execFileSync('sh', installArgs(context, ['--config', context.config]), { env: context.env });
    const installedConfig = join(context.configDir, 'agent.yaml');
    const previousConfig = readFileSync(installedConfig, 'utf8');
    const previousUnit = readFileSync(context.unitPath, 'utf8');
    writeAgentRelease(context.release, 'replacement');
    const replacementConfig = join(context.directory, 'replacement.yaml');
    writeFileSync(replacementConfig, previousConfig.replace('Child', 'Replacement'));
    writeFileSync(context.failRestart, 'fail');
    const failed = spawnSync('sh', installArgs(context, ['--config', replacementConfig]), { env: context.env, encoding: 'utf8' });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('previous files restored');
    expect(execFileSync(join(context.installDir, 'miobridge-agent'), ['--marker'], { encoding: 'utf8' }).trim()).toBe('initial');
    expect(readFileSync(installedConfig, 'utf8')).toBe(previousConfig);
    expect(readFileSync(context.unitPath, 'utf8')).toBe(previousUnit);
  });
});
