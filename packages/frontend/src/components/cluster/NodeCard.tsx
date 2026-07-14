import { useState } from 'react';
import { Icon } from '@iconify/react';
import type { NodeStatus } from '@/lib/types';
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

  const needsDeploy = node.nodeId !== 'local' && !node.agent?.deployed;
  const isRunning = node.agent?.status === 'running';
  const isDeploying = node.agent?.status === 'deploying';

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
            {node.nodeId === 'local' && (
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                }}
              >
                本机
              </span>
            )}
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

        <div className="flex items-center gap-4 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          <span className="flex items-center gap-1">
            <Icon icon="ph:map-pin" className="w-3.5 h-3.5" />
            {node.location}
          </span>
          {node.online && (
            <>
              <span className="flex items-center gap-1">
                <Icon icon="ph:tree-structure" className="w-3.5 h-3.5" />
                {node.nodesCount ?? '-'} {node.nodeId === 'local' ? '订阅节点' : '代理'}
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

        {/* Agent deployment actions — only for remote nodes */}
        {node.nodeId !== 'local' && (
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
        )}
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
