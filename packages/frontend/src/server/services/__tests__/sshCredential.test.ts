import { describe, expect, it } from 'vitest';
import { utils as sshUtils } from 'ssh2';
import { validateUploadedPrivateKey } from '../sshCredential';

describe('validateUploadedPrivateKey', () => {
  it('accepts an unencrypted OpenSSH private key', () => {
    const key = sshUtils.generateKeyPairSync('ed25519').private;

    expect(() => validateUploadedPrivateKey(key)).not.toThrow();
  });

  it('rejects a passphrase-protected private key', () => {
    const key = sshUtils.generateKeyPairSync('ed25519', {
      passphrase: 'test-passphrase',
      cipher: 'aes256-ctr',
      rounds: 16,
    }).private;

    expect(() => validateUploadedPrivateKey(key)).toThrow('暂不支持带口令的加密私钥');
  });

  it('rejects malformed private-key content', () => {
    expect(() => validateUploadedPrivateKey('not a private key')).toThrow('无效的 SSH 私钥文件');
  });

  it('rejects files larger than 64 KiB', () => {
    expect(() => validateUploadedPrivateKey('x'.repeat(64 * 1024 + 1))).toThrow('私钥文件不能超过 64 KiB');
  });
});
