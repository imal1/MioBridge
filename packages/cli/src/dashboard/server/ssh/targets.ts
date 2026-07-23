/**
 * Resolves node ids (and ad-hoc SSH inputs) into concrete `SshTarget`s, and
 * owns the one-time credential store used to pass a password/key for a single
 * deployment without persisting it.
 */
import type { NodeConfig, NodeKernelConfig } from '@miobridge/core';
import type { NodeCoreComposition } from '../../../composition.js';
import { validatePrivateKey } from './util.js';
import type { SshTarget } from './types.js';

export class NodeTargets {
  readonly #oneTimeCredentials = new Map<string, string>();

  constructor(private readonly composition: NodeCoreComposition) {}

  setOneTimeCredential(nodeId: string, credential: string): void {
    this.#oneTimeCredentials.set(nodeId, credential);
  }

  clearOneTimeCredential(nodeId: string): void {
    this.#oneTimeCredentials.delete(nodeId);
  }

  async findNode(nodeId: string): Promise<NodeConfig> {
    const node = (await this.composition.repository.list({ enabledOnly: false })).find(item => item.id === nodeId);
    if (!node) throw new Error(`节点 ${nodeId} 不存在`);
    return node;
  }

  async forNode(nodeId: string, kernels?: readonly NodeKernelConfig[]): Promise<SshTarget> {
    const node = await this.findNode(nodeId);
    const oneTimeCredential = this.#oneTimeCredentials.get(nodeId);
    if (node.id === 'local') {
      const persistedCredential = node.ssh?.credentialRef
        ? await this.composition.core.state.get(node.ssh.credentialRef)
        : null;
      const password = oneTimeCredential ?? persistedCredential;
      return {
        local: true,
        nodeId: node.id,
        nodeName: node.name,
        secret: node.secret,
        agentPort: node.port ?? node.agent?.port ?? 3001,
        kernels: kernels ?? node.kernels,
        ssh: {
          host: '127.0.0.1',
          user: typeof process.getuid === 'function' && process.getuid() === 0
            ? 'root'
            : process.env.USER?.trim() || 'miobridge',
          port: 0,
          authMethod: 'password',
          hostKey: '',
          ...(password ? { password } : {}),
        },
      };
    }
    if (!node.ssh) throw new Error('节点未配置 SSH 连接信息');
    const credential = oneTimeCredential ?? (node.ssh.credentialRef
      ? await this.composition.core.state.get(node.ssh.credentialRef)
      : null);
    if (!credential) throw new Error('节点 SSH 凭据不存在');
    if (node.ssh.authMethod === 'privateKey') validatePrivateKey(credential);
    return {
      nodeId: node.id,
      nodeName: node.name,
      secret: node.secret,
      agentPort: node.port ?? node.agent?.port ?? 3001,
      kernels: kernels ?? node.kernels,
      ssh: {
        host: node.host,
        user: node.ssh.user,
        port: node.ssh.port ?? 22,
        authMethod: node.ssh.authMethod,
        hostKey: node.ssh.hostKey,
        ...(node.ssh.authMethod === 'privateKey' ? { privateKey: credential } : { password: credential }),
      },
    };
  }

  async fromSsh(input: Record<string, unknown>): Promise<SshTarget> {
    const host = typeof input.host === 'string' ? input.host.trim() : '';
    const user = typeof input.user === 'string' ? input.user.trim() : '';
    const authMethod = input.authMethod === 'privateKey' ? 'privateKey' : input.authMethod === 'password' ? 'password' : null;
    const port = input.port === undefined ? 22 : Number(input.port);
    if (!host || !user || !authMethod) throw new Error('SSH 连接信息不完整');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 端口无效');
    const credential = authMethod === 'privateKey' ? input.privateKey : input.password;
    if (typeof credential !== 'string' || !credential) throw new Error('SSH 凭据不完整');
    if (authMethod === 'privateKey') validatePrivateKey(credential);
    return {
      nodeId: 'kernel-detection', nodeName: 'kernel-detection', secret: '', agentPort: 3001, kernels: [],
      ssh: {
        host, user, port, authMethod, hostKey: typeof input.hostKey === 'string' ? input.hostKey : '',
        ...(authMethod === 'privateKey' ? { privateKey: credential } : { password: credential }),
      },
    };
  }
}
