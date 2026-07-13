"use client";

import { Icon } from '@iconify/react';
import type { DeployStatus } from '@/lib/types';

interface DeployProgressDialogProps {
  isOpen: boolean;
  nodeName: string;
  status: DeployStatus | null;
  onClose: () => void;
}

const STEP_LABELS: Record<string, string> = {
  connect: 'SSH 连接',
  bun: '安装 Bun',
  kernel: '安装内核',
  agent: '部署 Agent',
  start: '启动服务',
  verify: '健康验证',
  done: '完成',
};

const STATUS_ICONS: Record<string, string> = {
  pending: 'ph:circle',
  running: 'ph:spinner-bold',
  success: 'ph:check-circle-bold',
  error: 'ph:x-circle-bold',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--muted-foreground)',
  running: 'var(--primary)',
  success: 'var(--fern)',
  error: 'var(--terracotta)',
};

/** All deploy steps in order, for rendering the step list */
const ALL_STEPS = ['connect', 'bun', 'kernel', 'agent', 'start', 'verify', 'done'];

export function DeployProgressDialog({ isOpen, nodeName, status, onClose }: DeployProgressDialogProps) {
  if (!isOpen) return null;

  const isDone = status?.step === 'done' || status?.status === 'error';
  const currentStepIndex = status ? ALL_STEPS.indexOf(status.step) : -1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={isDone ? onClose : undefined}>
      <div className="garden-card p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <Icon icon="ph:rocket-launch-bold" className="w-6 h-6" style={{ color: 'var(--primary)' }} />
          <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
            正在部署 {nodeName}
          </h3>
        </div>

        {/* Progress bar */}
        <div className="mb-4 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--muted)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${status?.progress || 0}%`,
              backgroundColor: status?.status === 'error' ? 'var(--terracotta)' : 'var(--fern)',
            }}
          />
        </div>

        {/* Step list — shows all steps with current/historical status */}
        <div className="space-y-2 mb-4">
          {ALL_STEPS.map((stepKey) => {
            const isCurrent = status?.step === stepKey;
            const isPast = currentStepIndex >= 0 && ALL_STEPS.indexOf(stepKey) < currentStepIndex;
            const isError = status?.status === 'error' && isCurrent;

            let stepStatus: string;
            let stepMessage: string;

            if (isPast) {
              stepStatus = 'success';
              stepMessage = STEP_LABELS[stepKey] || stepKey;
            } else if (isCurrent) {
              stepStatus = status.status;
              stepMessage = status.message || STEP_LABELS[stepKey] || stepKey;
            } else {
              stepStatus = 'pending';
              stepMessage = STEP_LABELS[stepKey] || stepKey;
            }

            return (
              <div key={stepKey} className="flex items-center gap-3">
                <Icon
                  icon={stepStatus === 'running' ? 'ph:spinner-bold' : STATUS_ICONS[stepStatus] || 'ph:circle'}
                  className={`w-5 h-5 ${stepStatus === 'running' ? 'animate-spin' : ''}`}
                  style={{ color: isError ? 'var(--terracotta)' : STATUS_COLORS[stepStatus] || 'var(--muted-foreground)' }}
                />
                <span className="text-sm" style={{ color: stepStatus === 'pending' ? 'var(--muted-foreground)' : 'var(--foreground)' }}>
                  {stepMessage}
                </span>
              </div>
            );
          })}
        </div>

        {isDone && (
          <button onClick={onClose}
            className="w-full px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}>
            {status?.status === 'error' ? '关闭' : '完成'}
          </button>
        )}
      </div>
    </div>
  );
}
