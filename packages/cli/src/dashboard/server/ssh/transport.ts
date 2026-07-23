/**
 * SSH/local command transport. Owns connection establishment and the
 * privilege-escalation policy; everything above it (installers, orchestrator)
 * runs commands through a `DeploymentConnection` without knowing whether the
 * target is a remote host or the local machine.
 */
import { spawn } from 'node:child_process';
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import { shellQuote } from './util.js';
import type { DeploymentConnection, DeploymentServiceOptions, ExecResult, SshTarget } from './types.js';

export class SshTransport {
  constructor(private readonly options: DeploymentServiceOptions = {}) {}

  connect(target: SshTarget): Promise<DeploymentConnection> {
    if (target.local) {
      return Promise.resolve({
        run: (command, input) => this.runLocal(command, input),
        end() {},
      });
    }
    return new Promise((resolve, reject) => {
      const client = new Client();
      const authentication: Pick<ConnectConfig, 'password' | 'privateKey'> = target.ssh.authMethod === 'privateKey'
        ? { privateKey: target.ssh.privateKey! }
        : { password: target.ssh.password! };
      const options: ConnectConfig = {
        host: target.ssh.host,
        port: target.ssh.port,
        username: target.ssh.user,
        readyTimeout: 15_000,
        ...authentication,
        hostHash: 'sha256',
        hostVerifier: (hashed: Buffer) => {
          const fingerprint = Buffer.isBuffer(hashed) ? hashed.toString('base64') : String(hashed);
          if (target.ssh.hostKey) return fingerprint === target.ssh.hostKey;
          target.ssh.hostKey = fingerprint;
          return true;
        },
      };
      client.once('ready', () => resolve({
        run: (command, input) => new Promise((resolveCommand, rejectCommand) => {
          client.exec(command, (error: Error | undefined, channel: ClientChannel) => {
            if (error) { rejectCommand(error); return; }
            let stdout = '';
            let stderr = '';
            channel.on('data', (data: Buffer) => { stdout += data.toString(); });
            channel.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
            channel.on('close', (code: number) => resolveCommand({ stdout, stderr, code: code ?? -1 }));
            if (input === undefined) channel.end(); else channel.end(input);
          });
        }),
        end: () => client.end(),
      }));
      client.once('error', error => reject(new Error(`SSH 连接失败: ${error.message}`)));
      client.connect(options);
    });
  }

  exec(ssh: DeploymentConnection, command: string, input?: string): Promise<ExecResult> {
    return ssh.run(command, input);
  }

  runLocal(command: string, input?: string): Promise<ExecResult> {
    if (this.options.runLocal) return this.options.runLocal(command, input);
    return new Promise((resolve, reject) => {
      const child = spawn('/bin/bash', ['-lc', command], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', data => { stdout += data.toString(); });
      child.stderr.on('data', data => { stderr += data.toString(); });
      child.once('error', reject);
      child.once('close', code => resolve({ stdout, stderr, code: code ?? -1 }));
      if (input === undefined) child.stdin.end(); else child.stdin.end(input);
    });
  }

  execRoot(ssh: DeploymentConnection, target: SshTarget, command: string): Promise<ExecResult> {
    if ((!target.local && target.ssh.user === 'root') || (target.local && typeof process.getuid === 'function' && process.getuid() === 0)) return this.exec(ssh, command);
    const elevated = target.ssh.password
      ? `sudo -S -p '' bash -lc ${shellQuote(command)}`
      : `sudo -n bash -lc ${shellQuote(command)}`;
    return this.exec(ssh, elevated, target.ssh.password ? `${target.ssh.password}\n` : undefined);
  }

  async execWithPrivilegeFallback(ssh: DeploymentConnection, target: SshTarget, command: string): Promise<ExecResult> {
    const direct = await this.exec(ssh, command);
    const alreadyRoot = target.local
      ? typeof process.getuid === 'function' && process.getuid() === 0
      : target.ssh.user === 'root';
    if (direct.code === 0 || alreadyRoot) return direct;
    const output = `${direct.stdout}\n${direct.stderr}`;
    if (!/permission denied|operation not permitted|must (?:be run|run) as root|requires? root|(?:当前)?非.*root.*用户|需要.*(?:root|管理员)|请.*root/iu.test(output)) {
      return direct;
    }
    return this.execRoot(ssh, target, command);
  }
}
