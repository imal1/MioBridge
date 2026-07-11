import { useState } from 'react';
import type { KernelDetection } from '@/server/services/deployManager';
import { KERNEL_TYPES, type KernelType, type NodeKernelConfig } from '@/server/types';
import StatusBadge from '@/components/shared/StatusBadge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const KERNEL_LABELS: Record<KernelType, string> = {
  'sing-box': 'Sing-Box',
  xray: 'Xray',
  v2ray: 'V2Ray',
};

interface KernelDetectionDialogProps {
  open: boolean;
  detections: KernelDetection[];
  monitoredTypes: KernelType[];
  submitting?: boolean;
  selectionLocked?: boolean;
  error?: string | null;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (kernels: NodeKernelConfig[]) => void;
}

export function KernelDetectionDialog({
  open,
  detections,
  monitoredTypes,
  submitting = false,
  selectionLocked = false,
  error = null,
  confirmLabel = '确认并部署',
  onCancel,
  onConfirm,
}: KernelDetectionDialogProps) {
  const [selected, setSelected] = useState<Set<KernelType>>(() => new Set(monitoredTypes));
  const detectionsByType = new Map(detections.map(detection => [detection.type, detection]));

  const toggle = (type: KernelType) => {
    if (selectionLocked) return;
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const confirm = () => {
    const kernels = KERNEL_TYPES.flatMap(type => {
      if (!selected.has(type)) return [];
      const configPath = detectionsByType.get(type)?.defaultConfigPath;
      return [{ type, ...(configPath ? { configPath } : {}) }];
    });
    onConfirm(kernels);
  };

  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen && !submitting) onCancel(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>选择监听内核</DialogTitle>
          <DialogDescription>选择至少一个内核。缺失的内核会在部署时安装。</DialogDescription>
        </DialogHeader>
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <div className="grid gap-3">
          {KERNEL_TYPES.map(type => {
            const detection = detectionsByType.get(type);
            const installed = detection?.installed ?? false;
            return (
              <label key={type} className="flex cursor-pointer items-start gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-container)] p-4">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-[var(--primary)]"
                  checked={selected.has(type)}
                  disabled={selectionLocked}
                  onChange={() => toggle(type)}
                  aria-label={`${KERNEL_LABELS[type]} ${installed ? '加入监听' : '安装并监听'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{KERNEL_LABELS[type]}</span>
                    <StatusBadge label={installed ? '已安装' : '未安装'} status={installed ? 'success' : 'warning'} />
                  </span>
                  <span className="mt-2 block text-sm text-muted-foreground">
                    {detection?.version || detection?.error || '未检测到版本'}
                  </span>
                  <span className="mt-1 block break-all text-xs text-muted-foreground">
                    默认配置：{detection?.defaultConfigPath || '未知'}
                  </span>
                  <span className="mt-2 block text-sm font-medium text-primary">
                    {installed ? '加入监听' : '安装并监听'}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>取消</Button>
          <Button type="button" disabled={selected.size === 0 || submitting} onClick={confirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
