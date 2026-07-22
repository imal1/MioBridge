import { useState } from 'react';
import { Icon } from '@iconify/react';
import type { NodeKernelConfig, NodeStatus } from '@/lib/types';
import { useUpdateNodeKernels } from '@/lib/queries/mutations';
import { NodeDetail } from './NodeDetail';
import { KernelStatusPills } from './KernelStatus';

interface NodeCardProps {
  node: NodeStatus;
  onUpdate?: (nodeId: string) => void;
  onHealthCheck?: (nodeId: string) => void;
  onDeploy?: (nodeId: string) => void;
  onUpdateAgent?: (nodeId: string) => void;
  onRestartAgent?: (nodeId: string) => void;
  onUninstallAgent?: (nodeId: string) => void;
}

export function NodeCard({
  node,
  onUpdate,
  onHealthCheck,
  onDeploy,
  onUpdateAgent,
  onRestartAgent,
  onUninstallAgent,
}: NodeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [adoptDismissed, setAdoptDismissed] = useState(false);
  const updateKernels = useUpdateNodeKernels();

  const needsDeploy = !node.agent?.deployed;
  const isRunning = node.agent?.status === 'running';
  const isDeploying = node.agent?.status === 'deploying';

  // Agent 打通后检测到、但尚未纳入监控的已装内核 → 提示用户确认纳管（点「纳管」即确认）。
  const adoptable = node.online ? (node.adoptableKernels ?? []) : [];
  const showAdopt = adoptable.length > 0 && !adoptDismissed;

  const handleAdopt = () => {
    const byType = new Map<string, NodeKernelConfig>(node.configuredKernels.map((k) => [k.type, k]));
    for (const type of adoptable) if (!byType.has(type)) byType.set(type, { type });
    updateKernels.mutate({ nodeId: node.nodeId, kernels: [...byType.values()] });
  };

  return (
    <>
      <div
        className="garden-card p-5 cursor-pointer transition-all hover:shadow-[var(--shadow-card-hover)]"
        onClick={() => setExpanded(!expanded)}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') setExpanded(!expanded); }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`live-dot ${node.online ? 'live-dot-active' : ''}`} />
            <h3
              className="text-base font-semibold"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--foreground)' }}
            >
              {node.name}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <Icon
              icon="ph:info-bold"
              className="w-4 h-4"
              style={{ color: 'var(--muted-foreground)' }}
            />
          </div>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          <KernelStatusPills
            online={node.online}
            kernels={node.kernels}
            configuredKernels={node.configuredKernels}
          />
        </div>

        {showAdopt && (
          <div
            className="mb-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs"
            style={{ backgroundColor: 'var(--secondary)', color: 'var(--secondary-foreground)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="flex items-center gap-1.5">
              <Icon icon="ph:magic-wand-bold" className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
              检测到未纳管内核：{adoptable.join('、')}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); handleAdopt(); }}
                disabled={updateKernels.isPending}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-all active:scale-[0.98] disabled:opacity-60"
                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}>
                <Icon icon={updateKernels.isPending ? 'ph:spinner-bold' : 'ph:check-bold'} className={`w-3 h-3 ${updateKernels.isPending ? 'animate-spin' : ''}`} />
                纳管
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setAdoptDismissed(true); }}
                className="px-2 py-1 rounded-md font-medium transition-all active:scale-[0.98]"
                style={{ color: 'var(--muted-foreground)' }}>
                忽略
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          <span className="flex items-center gap-1">
            <Icon icon="ph:map-pin" className="w-3.5 h-3.5" />
            {node.location}
          </span>
          {node.online && (
            <>
              <span className="flex items-center gap-1">
                <Icon icon="ph:tree-structure" className="w-3.5 h-3.5" />
                {node.nodesCount ?? '-'} 代理
              </span>
              {node.latency !== undefined && node.latency > 0 && (
                <span className="flex items-center gap-1">
                  <Icon icon="ph:lightning" className="w-3.5 h-3.5" />
                  {node.latency}ms
                </span>
              )}
            </>
          )}
          {!node.online && node.error && (
            <span className="flex items-center gap-1" style={{ color: 'var(--destructive)' }}>
              <Icon icon="ph:warning-circle-bold" className="w-3.5 h-3.5" />
              {node.error}
            </span>
          )}
        </div>

        <div className="flex gap-2 mt-3 pt-3">
          {needsDeploy && (
            <button
              onClick={(e) => { e.stopPropagation(); onDeploy?.(node.nodeId); }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-[0.98]"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}>
              <Icon icon="ph:rocket-launch-bold" className="w-3.5 h-3.5" />
              一键部署
            </button>
          )}
          {isRunning && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onUpdateAgent?.(node.nodeId); }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-[0.98]"
                style={{ backgroundColor: 'var(--secondary)', color: 'var(--secondary-foreground)' }}>
                <Icon icon="ph:arrow-clockwise-bold" className="w-3.5 h-3.5" />
                更新
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onRestartAgent?.(node.nodeId); }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-[0.98]"
                style={{ backgroundColor: 'var(--secondary)', color: 'var(--secondary-foreground)' }}>
                <Icon icon="ph:repeat-bold" className="w-3.5 h-3.5" />
                重启
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onUninstallAgent?.(node.nodeId); }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-[0.98]"
                style={{ backgroundColor: 'var(--destructive)', color: 'var(--destructive-foreground)' }}>
                <Icon icon="ph:trash-bold" className="w-3.5 h-3.5" />
                卸载
              </button>
            </>
          )}
          {isDeploying && (
            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--primary)' }}>
              <Icon icon="ph:spinner-bold" className="w-3.5 h-3.5 animate-spin" />
              部署中...
            </span>
          )}
        </div>
      </div>

      <NodeDetail
        node={node}
        isOpen={expanded}
        onClose={() => setExpanded(false)}
        onUpdate={onUpdate}
        onHealthCheck={onHealthCheck}
      />
    </>
  );
}
