import type { AgentDeploymentDiagnostics } from '@miobridge/core';
import type { SshTransport } from './transport.js';
import type { DeploymentConnection, SshTarget } from './types.js';
import { shellQuote, userSystemctl } from './util.js';
import { detectAgentService } from './agent.js';

/** Read-only evidence; never keep a diagnostic login open across public acceptance. */
export async function diagnoseAgentOn(transport: SshTransport, ssh: DeploymentConnection, target: SshTarget): Promise<AgentDeploymentDiagnostics> {
  const runtime = await detectAgentService(transport, ssh);
  const linger = runtime.mode === 'user'
    ? await transport.exec(ssh, `loginctl show-user ${shellQuote(runtime.user)} --property=Linger --value`)
    : undefined;
  const state = runtime.mode === 'system'
    ? await transport.exec(ssh, 'systemctl is-active miobridge-agent.service')
    : await transport.exec(ssh, userSystemctl('is-active', 'miobridge-agent.service'));
  const journal = runtime.mode === 'system'
    ? await transport.execRoot(ssh, target, 'journalctl -u miobridge-agent.service --no-pager -n 40 2>&1')
    : await transport.exec(ssh, 'journalctl --user -u miobridge-agent.service --no-pager -n 40 2>&1');
  const output = [journal.stdout, journal.stderr].filter(Boolean).join('\n').trim().slice(-6000);
  return {
    ...(linger?.code === 0 ? { lingerEnabled: linger.stdout.trim() === 'yes' } : {}),
    ...(state.stdout.trim() ? { serviceState: state.stdout.trim() } : {}),
    ...(output ? { journal: output, portConflict: /EADDRINUSE|address already in use|端口.*占用/i.test(output) } : {}),
  };
}

export async function diagnoseAgent(transport: SshTransport, target: SshTarget, signal?: AbortSignal): Promise<AgentDeploymentDiagnostics> {
  const ssh = await transport.connect(target);
  const close = () => { void Promise.resolve(ssh.end()).catch(() => undefined); };
  signal?.addEventListener('abort', close, { once: true });
  try {
    if (signal?.aborted) throw new Error('SSH 诊断超时');
    return await diagnoseAgentOn(transport, ssh, target);
  } finally { signal?.removeEventListener('abort', close); await ssh.end(); }
}
