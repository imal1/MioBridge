import { useState } from 'react';
import { Icon } from '@iconify/react';

interface BatchActionsProps {
  totalNodes: number;
  onlineNodes: number;
  onUpdateAll: () => Promise<void>;
  onHealthCheckAll: () => Promise<void>;
}

export function BatchActions({
  totalNodes,
  onlineNodes,
  onUpdateAll,
  onHealthCheckAll,
}: BatchActionsProps) {
  const [updating, setUpdating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleUpdateAll = async () => {
    setUpdating(true);
    setFeedback(null);
    try {
      await onUpdateAll();
      setFeedback({ type: 'success', message: `已触发 ${totalNodes} 个节点更新` });
    } catch {
      setFeedback({ type: 'error', message: '批量更新失败' });
    } finally {
      setUpdating(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  const handleHealthCheckAll = async () => {
    setChecking(true);
    setFeedback(null);
    try {
      await onHealthCheckAll();
      setFeedback({ type: 'success', message: `已对 ${totalNodes} 个节点执行健康检查` });
    } catch {
      setFeedback({ type: 'error', message: '批量健康检查失败' });
    } finally {
      setChecking(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  return (
    <div className="garden-card p-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Icon
            icon="ph:stack-bold"
            className="w-5 h-5"
            style={{ color: 'var(--primary)' }}
          />
          <span
            className="text-sm font-semibold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--foreground)' }}
          >
            批量操作
          </span>
          <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
            ({onlineNodes}/{totalNodes} 在线)
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleUpdateAll}
            disabled={updating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-[0.98]"
            style={{
              backgroundColor: 'var(--primary)',
              color: 'var(--primary-foreground)',
              opacity: updating ? 0.6 : 1,
            }}
          >
            <Icon
              icon={updating ? 'ph:spinner-bold' : 'ph:arrow-clockwise-bold'}
              className={`w-4 h-4 ${updating ? 'animate-spin' : ''}`}
            />
            全部更新
          </button>

          <button
            onClick={handleHealthCheckAll}
            disabled={checking}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-[0.98]"
            style={{
              backgroundColor: 'var(--secondary)',
              color: 'var(--secondary-foreground)',
              opacity: checking ? 0.6 : 1,
            }}
          >
            <Icon
              icon={checking ? 'ph:spinner-bold' : 'ph:heartbeat-bold'}
              className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`}
            />
            全部健康检查
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`garden-alert mt-3 ${
            feedback.type === 'success' ? 'garden-alert-success' : 'garden-alert-danger'
          }`}
        >
          <Icon
            icon={feedback.type === 'success' ? 'ph:check-circle-bold' : 'ph:warning-circle-bold'}
            className="w-4 h-4 flex-shrink-0 mt-0.5"
          />
          <p className="text-sm">{feedback.message}</p>
        </div>
      )}
    </div>
  );
}
