import { describe, expect, it } from 'vitest';
import { agentRelease } from '../../src/dashboard/server/sshDeployment.js';

describe('Agent release distribution', () => {
  it('maps remote architectures to versioned release artifacts', () => {
    expect(agentRelease('1.0.0', 'x64', {})).toEqual({
      artifact: 'miobridge-agent-1.0.0-linux-x64.gz',
      baseUrl: 'https://github.com/imal1/MioBridge/releases/download/v1.0.0',
    });
    expect(agentRelease('1.0.0', 'arm64', {})).toEqual({
      artifact: 'miobridge-agent-1.0.0-linux-arm64.gz',
      baseUrl: 'https://github.com/imal1/MioBridge/releases/download/v1.0.0',
    });
  });

  it('uses the configured repository or release mirror', () => {
    expect(agentRelease('1.2.3', 'x64', { MIOBRIDGE_REPOSITORY: 'owner/repo' }).baseUrl)
      .toBe('https://github.com/owner/repo/releases/download/v1.2.3');
    expect(agentRelease('1.2.3', 'x64', { MIOBRIDGE_RELEASE_BASE_URL: 'https://mirror.example/v1.2.3' }).baseUrl)
      .toBe('https://mirror.example/v1.2.3');
  });
});
