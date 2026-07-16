import { describe, expect, it } from 'vitest';
import {
  KERNEL_SCRIPTS,
  installCommand,
  installerUrl,
  repairCommand,
  reinstallCommand,
  uninstallCommand,
  upgradeCommand,
  wrapperCommand,
} from '../../src/dashboard/server/kernelScripts.js';

describe('233boy kernel script contract', () => {
  it('maps every kernel to its 233boy repository and system paths', () => {
    expect(installerUrl('sing-box')).toBe('https://raw.githubusercontent.com/233boy/sing-box/main/install.sh');
    expect(installerUrl('xray')).toBe('https://raw.githubusercontent.com/233boy/Xray/main/install.sh');
    expect(installerUrl('v2ray')).toBe('https://raw.githubusercontent.com/233boy/v2ray/master/install.sh');
    expect(KERNEL_SCRIPTS.xray).toMatchObject({
      wrapperPath: '/usr/local/bin/xray',
      corePath: '/etc/xray/bin/xray',
      configPath: '/etc/xray/config.json',
      configDir: '/etc/xray/conf',
    });
  });

  it('downloads the installer before executing it and supports curl or wget', () => {
    const command = installCommand('sing-box');
    expect(command).toContain('curl -fsSL --retry 3');
    expect(command).toContain('wget -qO');
    expect(command).toContain('test -s "$workdir/install.sh"');
    expect(command).toContain('bash "$workdir/install.sh"');
    expect(command).not.toContain('| bash');
  });

  it('uses absolute 233boy wrapper paths for lifecycle actions', () => {
    expect(wrapperCommand('v2ray', 'url', 'tcp')).toBe("'/usr/local/bin/v2ray' 'url' 'tcp'");
    expect(upgradeCommand('xray')).toContain("'/usr/local/bin/xray' 'update' 'core'");
    expect(upgradeCommand('xray')).toContain("'/usr/local/bin/xray' 'update.sh'");
    expect(repairCommand('sing-box')).toContain("'/usr/local/bin/sing-box' 'fix-all'");
  });

  it('preserves both aggregate and per-profile configuration during uninstall', () => {
    const command = uninstallCommand('v2ray', true);
    expect(command).toContain('/etc/v2ray/config.json');
    expect(command).toContain('/etc/v2ray/conf');
    expect(command).toContain("printf 'y\\n1\\n'");
    expect(uninstallCommand('v2ray', false)).not.toContain('backup=');
  });

  it('restores preserved profiles after reinstall and also restores them on installer failure', () => {
    const command = reinstallCommand('xray', true);
    expect(command).toContain('trap finish EXIT');
    expect(command).toContain('if [ "$status" -ne 0 ]; then restore_config || true; fi');
    expect(command).toContain("'/usr/local/bin/xray' 'uninstall'");
    expect(command).toContain('bash "$workdir/install.sh"');
    expect(command).toContain("'/usr/local/bin/xray' 'restart'");
    expect(command).toContain('rm -rf \'/etc/xray/conf\'');
  });
});
