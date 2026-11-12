import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { NodeCoreComposition } from '../../../composition.js';
import type { SshTransport } from './transport.js';
import type { NodeTargets } from './targets.js';
import { shellQuote } from './util.js';
const exec = promisify(execFile);

/** Installs a controller-owned key using the transient bootstrap credential. */
export async function enrollControllerKey(composition: NodeCoreComposition, transport: SshTransport, targets: NodeTargets, nodeId: string): Promise<void> {
  const target = await targets.forNode(nodeId);
  if (target.local) return;
  const key = await composition.core.state.withLock('ssh-key-generation', async () => {
    const directory = join(composition.paths.baseDir, 'ssh');
    await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
    const path = join(directory, 'id_ed25519');
    try { await readFile(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await exec('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'miobridge-controller', '-f', path]);
    }
    await chmod(path, 0o600);
    return { privateKey: await readFile(path, 'utf8'), publicKey: (await readFile(`${path}.pub`, 'utf8')).trim() };
  });
  const ssh = await transport.connect(target);
  try {
    const publicKey = shellQuote(key.publicKey);
    const result = await transport.exec(ssh, `umask 077; mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh" && touch "$HOME/.ssh/authorized_keys" && chmod 600 "$HOME/.ssh/authorized_keys" && (grep -qxF ${publicKey} "$HOME/.ssh/authorized_keys" || printf '\\n%s\\n' ${publicKey} >> "$HOME/.ssh/authorized_keys")`);
    if (result.code !== 0) throw new Error('无法安装主控 SSH 公钥，请检查 .ssh 权限');
  } finally { await ssh.end(); }
  const { password: _password, ...keySsh } = target.ssh;
  const verified = await transport.connect({ ...target, ssh: { ...keySsh, authMethod: 'privateKey', privateKey: key.privateKey } });
  await verified.end();
  await composition.repository.update(nodeId, node => ({ ...node, ssh: { ...node.ssh!, authMethod: 'privateKey', credentialRef: 'ssh/id_ed25519', hostKey: target.ssh.hostKey } }));
  targets.clearOneTimeCredential(nodeId);
}
