import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMioBridgeBaseDir } from '../runtimePaths';

describe('runtime paths', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses MIOBRIDGE_CONFIG_DIR when it is set', () => {
    process.env.MIOBRIDGE_CONFIG_DIR = '/tmp/miobridge-custom';
    process.env.VERCEL = '1';

    expect(getMioBridgeBaseDir()).toBe('/tmp/miobridge-custom');
  });

  it('uses a writable temp directory on Vercel when no config dir is set', () => {
    delete process.env.MIOBRIDGE_CONFIG_DIR;
    process.env.VERCEL = '1';

    expect(getMioBridgeBaseDir()).toBe(path.join(os.tmpdir(), 'miobridge'));
  });
});
