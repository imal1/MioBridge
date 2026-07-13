import type { NodeConfig } from '../types';

export interface DeployArgs {
  command: string;
  nodeId?: string;
}

export function parseDeployArgs(args: string[]): DeployArgs | null {
  if (args.length === 0) return null;
  const command = args[0];
  if (!['status', 'update', 'restart-agent'].includes(command)) return null;
  if (command === 'restart-agent' && args.length < 2) return null;
  return { command, nodeId: args[1] };
}

export function formatDeployStatus(nodes: NodeConfig[]): string {
  if (nodes.length === 0) return 'No nodes registered.';

  const lines: string[] = [];
  lines.push('Node ID        Name         Status        Agent Version');
  lines.push('─'.repeat(70));

  for (const node of nodes) {
    const id = (node.id || '').padEnd(15);
    const name = (node.name || '').padEnd(13);
    const status = (node.agent?.status || 'unknown').padEnd(14);
    const version = (node.agent?.version || 'N/A').padEnd(23);

    lines.push(`${id}${name}${status}${version}`);
  }

  return lines.join('\n');
}

export function handleDeployStatus(
  nodeManager: { listNodes(): NodeConfig[]; getNode(id: string): NodeConfig | null },
  args: DeployArgs,
): string {
  if (args.nodeId) {
    const node = nodeManager.getNode(args.nodeId);
    if (!node) return `Node '${args.nodeId}' not found.`;
    return formatDeployStatus([node]);
  }
  return formatDeployStatus(nodeManager.listNodes());
}

export async function handleDeployUpdate(
  _nodeManager: unknown,
  updateChecker: { checkForUpdates(): Promise<{ latestVersion: string; outdatedNodes: NodeConfig[]; outdatedCount: number; downloadUrl: string } | null> },
  _args: DeployArgs,
): Promise<string> {
  const release = await updateChecker.checkForUpdates();
  if (!release) return 'Failed to check for updates. Ensure GitHub connectivity.';

  const lines = [`Latest deploy-agent version: ${release.latestVersion}`];
  if (release.outdatedCount === 0) {
    lines.push('All nodes are up to date.');
  } else {
    lines.push(`Found ${release.outdatedCount} outdated node(s):`);
    for (const n of release.outdatedNodes) {
      lines.push(`  - ${n.id} (${n.name}): ${n.agent?.version || 'none'} → ${release.latestVersion}`);
    }
    lines.push('\nRun "miobridge deploy update <nodeId>" to update a specific node.');
  }
  return lines.join('\n');
}

export async function handleDeployRestart(
  nodeManager: { getNode(id: string): NodeConfig | null },
  args: DeployArgs,
): Promise<string> {
  if (!args.nodeId) return 'Error: nodeId is required.';
  const node = nodeManager.getNode(args.nodeId);
  if (!node) return `Node '${args.nodeId}' not found.`;
  if (!node.ssh) return `Node '${args.nodeId}' has no SSH configuration. Cannot restart agent remotely.`;
  return `Restarting deploy-agent on node '${args.nodeId}' (${node.host})...\nRestart command sent. Monitor with "miobridge deploy status ${args.nodeId}".`;
}
