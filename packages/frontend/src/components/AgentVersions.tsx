import { useState } from 'react';
import { useClusterStatus, useStatus } from '@/lib/queries';
import { deployAndWait } from '@/lib/serverSetup';
import { errorMessage } from '@/lib/errorMessage';
export function AgentVersions() {
  const cluster = useClusterStatus(); const status = useStatus();
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const expected = status.data?.version?.replace(/^v/, '');
  const outdated = cluster.data?.nodes.filter(node => {
    const version = (node.version || node.agent?.version)?.replace(/^v/, '');
    return node.agent?.deployed && version && expected && /^\d+\.\d+\.\d+$/.test(expected) && /^\d+\.\d+\.\d+$/.test(version) && version.localeCompare(expected, undefined, { numeric: true }) < 0;
  }) ?? [];
  if (!outdated.length && !message) return null;
  return <aside className="mb-card mb-3 p-3" role="status">{outdated.length} 台服务器 Agent 版本落后 <button disabled={busy || !outdated.length} className="mb-pill-btn" onClick={async () => {
    setBusy(true);
    try {
      for (const node of outdated) await deployAndWait(node.nodeId, 'agent', 'upgrade', value => setMessage(`${node.name}：${value}`));
      setMessage('升级完成'); await cluster.refetch();
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }}>逐台升级</button><p>{message}</p></aside>;
}
