import type { NodeConfig } from '../types';

export type NodeDeployResult = { success: boolean; message: string };
export type NodeDeployDelegate = (node: NodeConfig) => Promise<NodeDeployResult>;

/**
 * Frontend-owned operational seam. Core node services deliberately know nothing
 * about SSH credentials, deployment jobs, systemd, or dashboard callbacks.
 */
export class NodeOperationsAdapter {
  private deployDelegate: NodeDeployDelegate | null = null;

  setDeployDelegate(delegate: NodeDeployDelegate): void {
    this.deployDelegate = delegate;
  }

  canAutoDeploy(node: NodeConfig): boolean {
    return this.deployDelegate !== null && node.kernels.length > 0 && Boolean(node.ssh) && node.agent?.status === 'not_deployed';
  }

  deploy(node: NodeConfig): Promise<NodeDeployResult> | null {
    return this.deployDelegate?.(node) ?? null;
  }
}
