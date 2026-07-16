// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KernelDetection } from '@/lib/types';

const detections: KernelDetection[] = [
  { type: 'sing-box', installed: true, version: '1.11.0', defaultConfigPath: '/etc/sing-box/config.json' },
  { type: 'xray', installed: false, defaultConfigPath: '/etc/xray/config.json' },
  { type: 'v2ray', installed: false, error: '未找到可执行文件', defaultConfigPath: '/etc/v2ray/config.json' },
];

describe('KernelDetectionDialog', () => {
  it('renders all detections with the action required for their installed state', async () => {
    const { KernelDetectionDialog } = await import('@/components/cluster/KernelDetectionDialog');
    render(<KernelDetectionDialog open detections={detections} monitoredTypes={[]} onCancel={() => {}} onConfirm={() => {}} />);

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByText('Sing-Box')).toBeDefined();
    expect(screen.getByText('Xray')).toBeDefined();
    expect(screen.getByText('V2Ray')).toBeDefined();
    expect(screen.getAllByText('加入监听')).toHaveLength(1);
    expect(screen.getAllByText('安装并监听')).toHaveLength(2);
    expect(screen.getByText('1.11.0')).toBeDefined();
    expect(screen.getByText('未找到可执行文件')).toBeDefined();
    expect(screen.getByText(/\/etc\/sing-box\/config.json/)).toBeDefined();
  });

  it('preselects only currently monitored kernels and emits configs in supported order', async () => {
    const { KernelDetectionDialog } = await import('@/components/cluster/KernelDetectionDialog');
    const onConfirm = vi.fn();
    render(<KernelDetectionDialog open detections={detections} monitoredTypes={['v2ray']} onCancel={() => {}} onConfirm={onConfirm} />);

    const singBox = screen.getByRole('checkbox', { name: /Sing-Box/ }) as HTMLInputElement;
    const xray = screen.getByRole('checkbox', { name: /Xray/ }) as HTMLInputElement;
    const v2ray = screen.getByRole('checkbox', { name: /V2Ray/ }) as HTMLInputElement;
    expect(singBox.checked).toBe(false);
    expect(xray.checked).toBe(false);
    expect(v2ray.checked).toBe(true);

    fireEvent.click(xray);
    fireEvent.click(singBox);
    fireEvent.click(screen.getByRole('button', { name: '确认并部署' }));
    expect(onConfirm).toHaveBeenCalledWith([
      { type: 'sing-box', configPath: '/etc/sing-box/config.json' },
      { type: 'xray', configPath: '/etc/xray/config.json' },
      { type: 'v2ray', configPath: '/etc/v2ray/config.json' },
    ]);
  });

  it('disables confirmation with no selection and cancellation submits nothing', async () => {
    const { KernelDetectionDialog } = await import('@/components/cluster/KernelDetectionDialog');
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<KernelDetectionDialog open detections={detections} monitoredTypes={[]} onCancel={onCancel} onConfirm={onConfirm} />);

    expect((screen.getByRole('button', { name: '确认并部署' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('resets selection when a new keyed detection result is rendered', async () => {
    const { KernelDetectionDialog } = await import('@/components/cluster/KernelDetectionDialog');
    const { rerender } = render(
      <KernelDetectionDialog key="first" open detections={detections} monitoredTypes={['sing-box']} onCancel={() => {}} onConfirm={() => {}} />
    );
    expect((screen.getByRole('checkbox', { name: /Sing-Box/ }) as HTMLInputElement).checked).toBe(true);

    rerender(<KernelDetectionDialog key="second" open detections={[...detections].reverse()} monitoredTypes={['xray']} onCancel={() => {}} onConfirm={() => {}} />);
    expect((screen.getByRole('checkbox', { name: /Sing-Box/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: /Xray/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('ignores close controls while submitting', async () => {
    const { KernelDetectionDialog } = await import('@/components/cluster/KernelDetectionDialog');
    const onCancel = vi.fn();
    render(<KernelDetectionDialog open detections={detections} monitoredTypes={['sing-box']} submitting onCancel={onCancel} onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByText('选择监听内核')).toBeDefined();
  });

  it('locks all selections after persistence while leaving deploy retry available', async () => {
    const { KernelDetectionDialog } = await import('@/components/cluster/KernelDetectionDialog');
    const onConfirm = vi.fn();
    render(<KernelDetectionDialog open detections={detections} monitoredTypes={['xray']} selectionLocked confirmLabel="重试部署" onCancel={() => {}} onConfirm={onConfirm} />);
    const xray = screen.getByRole('checkbox', { name: /Xray/ }) as HTMLInputElement;
    const singBox = screen.getByRole('checkbox', { name: /Sing-Box/ }) as HTMLInputElement;
    expect(xray.disabled).toBe(true);
    expect(singBox.disabled).toBe(true);
    fireEvent.click(singBox);
    expect(singBox.checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '重试部署' }));
    expect(onConfirm).toHaveBeenCalledWith([{ type: 'xray', configPath: '/etc/xray/config.json' }]);
  });
});
