/** A node must have only one deployment/repair/migration changing its runtime at a time. */
const busy = new Set<string>();
export function acquireNodeMutation(nodeId: string): () => void {
  if (busy.has(nodeId)) throw new Error('节点正在部署或维护，请等待当前操作完成');
  busy.add(nodeId);
  return () => { busy.delete(nodeId); };
}
export async function withNodeMutation<T>(nodeId: string, action: () => Promise<T>): Promise<T> {
  const release = acquireNodeMutation(nodeId);
  try { return await action(); } finally { release(); }
}
