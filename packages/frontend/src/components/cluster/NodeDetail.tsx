import { useState } from 'react';
import { Icon } from '@iconify/react';
import InfoRow from '@/components/shared/InfoRow';
import StatusBadge from '@/components/shared/StatusBadge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { NodeStatus } from '@/lib/types';
import { KernelRuntimeDetails } from './KernelStatus';

interface NodeDetailProps {
  node: NodeStatus;
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: (nodeId: string) => void;
  onHealthCheck?: (nodeId: string) => void;
}

export function NodeDetail({
  node,
  isOpen,
  onClose,
  onUpdate,
  onHealthCheck,
}: NodeDetailProps) {
  const [updating, setUpdating] = useState(false);
  const [checking, setChecking] = useState(false);

  const formatUptime = (s?: number) => {
    if (!s && s !== 0) return '-';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const handleUpdate = async () => {
    if (!onUpdate) return;
    setUpdating(true);
    try {
      await onUpdate(node.nodeId);
    } finally {
      setUpdating(false);
    }
  };

  const handleHealthCheck = async () => {
    if (!onHealthCheck) return;
    setChecking(true);
    try {
      await onHealthCheck(node.nodeId);
    } finally {
      setChecking(false);
    }
  };

  const agentStatusLabel = (status?: string) => {
    switch (status) {
      case 'running': return '运行中';
      case 'stopped': return '已停止';
      case 'deploying': return '部署中';
      case 'error': return '异常';
      case 'not_deployed':
      default: return '未部署';
    }
  };

  const agentStatusColor = (status?: string) => {
    switch (status) {
      case 'running': return 'success';
      case 'error': return 'danger';
      case 'deploying': return 'warning';
      case 'not_deployed':
      default: return 'warning';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
            <span className={`live-dot ${node.online ? 'live-dot-active' : ''}`} />
            {node.name}
          </DialogTitle>
        </DialogHeader>

      {!node.online ? (
        <div className="garden-alert garden-alert-danger mb-4">
          <Icon icon="ph:warning-circle-bold" className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold">节点离线</p>
            <p className="text-sm mt-0.5 opacity-90">{node.error || '未知错误'}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <InfoRow label="节点角色">
            <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              子节点仅提供节点源，订阅与 Clash 配置由主节点统一生成
            </span>
          </InfoRow>
          <InfoRow label="代理数">
            <span className="font-mono text-sm" style={{ color: 'var(--foreground)' }}>
              {node.nodesCount ?? '-'}
            </span>
          </InfoRow>
          <InfoRow label="运行时间">
            <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              {formatUptime(node.uptime)}
            </span>
          </InfoRow>
          <InfoRow label="版本">
            <span className="font-mono text-xs" style={{ color: 'var(--muted-foreground)' }}>
              {node.version ?? '-'}
            </span>
          </InfoRow>
          {node.latency !== undefined && node.latency > 0 && (
            <InfoRow label="延迟">
              <span className="font-mono text-sm" style={{ color: 'var(--foreground)' }}>
                {node.latency}ms
              </span>
            </InfoRow>
          )}
        </div>
      )}

      <div className="mt-4">
        <h3
          className="mb-2 text-xs font-semibold uppercase tracking-widest"
          style={{ color: 'var(--muted-foreground)', fontFamily: 'var(--font-display)' }}
        >
          内核运行状态
        </h3>
        <KernelRuntimeDetails
          online={node.online}
          kernels={node.kernels}
          configuredKernels={node.configuredKernels}
        />
      </div>

      {node.agent && (
        <div className="mt-4 rounded-2xl bg-[var(--surface-container)] p-3">
          <h4
            className="text-xs font-semibold uppercase tracking-widest mb-2"
            style={{ color: 'var(--muted-foreground)', fontFamily: 'var(--font-display)' }}
          >
            部署信息
          </h4>
          <div className="space-y-1">
            <InfoRow label="Agent">
              <span className="text-sm" style={{ color: 'var(--foreground)' }}>
                {node.agent.version || '-'}
              </span>
              <StatusBadge
                label={agentStatusLabel(node.agent.status)}
                status={agentStatusColor(node.agent.status)}
              />
            </InfoRow>
            {node.agent.lastDeploy && (
              <InfoRow label="部署时间">
                <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  {new Date(node.agent.lastDeploy).toLocaleString('zh-CN')}
                </span>
              </InfoRow>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3 mt-4">
        {onUpdate && (
          <button
            onClick={handleUpdate}
            disabled={updating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-[0.98]"
            style={{
              backgroundColor: 'var(--primary)',
              color: 'var(--primary-foreground)',
              opacity: updating ? 0.6 : 1,
            }}
          >
            <Icon icon={updating ? 'ph:spinner-bold' : 'ph:arrow-clockwise-bold'} className={`w-4 h-4 ${updating ? 'animate-spin' : ''}`} />
            更新订阅
          </button>
        )}
        {onHealthCheck && (
          <button
            onClick={handleHealthCheck}
            disabled={checking}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-[0.98]"
            style={{
              backgroundColor: 'var(--secondary)',
              color: 'var(--secondary-foreground)',
              opacity: checking ? 0.6 : 1,
            }}
          >
            <Icon icon={checking ? 'ph:spinner-bold' : 'ph:heartbeat-bold'} className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
            健康检查
          </button>
        )}
      </div>
      </DialogContent>
    </Dialog>
  );
}
