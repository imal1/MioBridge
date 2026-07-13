import { Buffer } from 'buffer';
import { createPrivateKey } from 'crypto';

const MAX_PRIVATE_KEY_BYTES = 64 * 1024;

export function validateUploadedPrivateKey(value: string): void {
  if (Buffer.byteLength(value, 'utf8') > MAX_PRIVATE_KEY_BYTES) {
    throw new Error('私钥文件不能超过 64 KiB');
  }

  const trimmed = value.trim();
  if (trimmed.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----') ||
      /Proc-Type:\s*4,ENCRYPTED/i.test(trimmed) ||
      /DEK-Info:/i.test(trimmed)) {
    throw new Error('暂不支持带口令的加密私钥');
  }

  try {
    if (trimmed.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')) {
      validateOpenSshEnvelope(trimmed);
    } else {
      createPrivateKey(trimmed);
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'encrypted') {
      throw new Error('暂不支持带口令的加密私钥');
    }
    throw new Error('无效的 SSH 私钥文件');
  }
}

function validateOpenSshEnvelope(value: string): void {
  const match = value.match(/^-----BEGIN OPENSSH PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+?)\s+-----END OPENSSH PRIVATE KEY-----$/);
  if (!match) throw new Error('invalid');

  const encoded = match[1].replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('invalid');
  const data = Buffer.from(encoded, 'base64');
  const magic = Buffer.from('openssh-key-v1\0');
  if (data.length <= magic.length || !data.subarray(0, magic.length).equals(magic)) {
    throw new Error('invalid');
  }

  let offset = magic.length;
  const readString = () => {
    if (offset + 4 > data.length) throw new Error('invalid');
    const length = data.readUInt32BE(offset);
    offset += 4;
    if (length > data.length - offset) throw new Error('invalid');
    const result = data.subarray(offset, offset + length);
    offset += length;
    return result;
  };

  const cipher = readString().toString('utf8');
  const kdf = readString().toString('utf8');
  const kdfOptions = readString();
  if (cipher !== 'none' || kdf !== 'none' || kdfOptions.length !== 0) {
    throw new Error('encrypted');
  }
  if (offset + 4 > data.length) throw new Error('invalid');
  const keyCount = data.readUInt32BE(offset);
  offset += 4;
  if (keyCount < 1 || keyCount > 16) throw new Error('invalid');
  for (let index = 0; index < keyCount; index++) readString();
  const privateSection = readString();
  if (offset !== data.length || privateSection.length < 8 ||
      privateSection.readUInt32BE(0) !== privateSection.readUInt32BE(4)) {
    throw new Error('invalid');
  }
}
