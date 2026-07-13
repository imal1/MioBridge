// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const detections = [
  { type: 'sing-box' as const, installed: true, version: '1.11.0', defaultConfigPath: '/etc/sing-box/config.json' },
  { type: 'xray' as const, installed: false, defaultConfigPath: '/usr/local/etc/xray/config.json' },
  { type: 'v2ray' as const, installed: false, defaultConfigPath: '/usr/local/etc/v2ray/config.json' },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('AddNodeForm', () => {
  it('should render form with required fields', async () => {
    const { AddNodeForm } = await import('@/components/cluster/AddNodeForm');
    render(
      React.createElement(AddNodeForm, {
        isOpen: true,
        onClose: () => {},
        onComplete: () => {},
      })
    );
    expect(screen.getByText('SSH 连接信息')).toBeDefined();
    expect(screen.getByRole('button', { name: '密码' })).toBeDefined();
    expect(screen.queryByLabelText('SSH 私钥文件')).toBeNull();
  });

  it('uploads a private-key file instead of accepting private-key text', async () => {
    const { AddNodeForm } = await import('@/components/cluster/AddNodeForm');
    render(<AddNodeForm isOpen onClose={() => {}} onComplete={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: '私钥' }));
    const input = screen.getByLabelText('SSH 私钥文件');
    const file = new File(['private-key-content'], 'id_ed25519');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('id_ed25519')).toBeDefined());
    expect(screen.queryByRole('textbox', { name: 'SSH 私钥' })).toBeNull();
    expect(screen.queryByLabelText('SSH 密码')).toBeNull();
  });

  it('detects kernels before creating the node and deploying the selected kernels', async () => {
    const { AddNodeForm } = await import('@/components/cluster/AddNodeForm');
    const calls: string[] = [];
    const detectKernels = vi.fn(async () => { calls.push('detect'); return detections; });
    const createNode = vi.fn(async () => {
      calls.push('create');
      return { success: true, data: { id: 'node-sg' }, timestamp: new Date().toISOString() };
    });
    const deployNode = vi.fn(async () => {
      calls.push('deploy');
      return { success: true, timestamp: new Date().toISOString() };
    });

    render(<AddNodeForm isOpen onClose={() => {}} onComplete={() => {}} detectKernels={detectKernels} createNode={createNode} deployNode={deployNode} />);
    fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '新加坡' } });
    fireEvent.change(screen.getByLabelText('主机地址'), { target: { value: 'sg.example.com' } });
    fireEvent.change(screen.getByLabelText('地域标签'), { target: { value: 'SG' } });
    fireEvent.change(screen.getByLabelText('SSH 密码'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '检测内核' }));

    await screen.findByText('选择监听内核');
    expect(calls).toEqual(['detect']);
    expect(createNode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Sing-Box/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认并部署' }));

    await waitFor(() => expect(calls).toEqual(['detect', 'create', 'deploy']));
    expect(detectKernels).toHaveBeenCalledWith({ ssh: {
      host: 'sg.example.com', user: 'root', authMethod: 'password', password: 'secret',
    } });
    expect(createNode).toHaveBeenCalledWith(expect.objectContaining({
      name: '新加坡', host: 'sg.example.com', kernels: [{ type: 'sing-box', configPath: '/etc/sing-box/config.json' }],
    }));
    expect(deployNode).toHaveBeenCalledWith('node-sg', [{ type: 'sing-box', configPath: '/etc/sing-box/config.json' }]);
  });

  it('preserves entered values and creates nothing when detection fails', async () => {
    const { AddNodeForm } = await import('@/components/cluster/AddNodeForm');
    const createNode = vi.fn();
    const deployNode = vi.fn();
    const detectKernels = vi.fn(async () => { throw new Error('SSH 连接失败'); });
    render(<AddNodeForm isOpen onClose={() => {}} onComplete={() => {}} detectKernels={detectKernels} createNode={createNode} deployNode={deployNode} />);

    fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '东京' } });
    fireEvent.change(screen.getByLabelText('主机地址'), { target: { value: 'tokyo.example.com' } });
    fireEvent.change(screen.getByLabelText('地域标签'), { target: { value: 'JP' } });
    fireEvent.change(screen.getByLabelText('SSH 密码'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '检测内核' }));

    expect(await screen.findByText('SSH 连接失败')).toBeDefined();
    expect((screen.getByLabelText('节点名称') as HTMLInputElement).value).toBe('东京');
    expect((screen.getByLabelText('主机地址') as HTMLInputElement).value).toBe('tokyo.example.com');
    expect(createNode).not.toHaveBeenCalled();
    expect(deployNode).not.toHaveBeenCalled();
  });

  it('creates once and retries deployment with the existing node id after deploy start fails', async () => {
    const { AddNodeForm } = await import('@/components/cluster/AddNodeForm');
    const createNode = vi.fn(async () => ({ success: true, data: { id: 'node-retry' }, timestamp: '' }));
    const deployNode = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'queue unavailable', timestamp: '' })
      .mockResolvedValueOnce({ success: true, timestamp: '' });
    render(<AddNodeForm isOpen onClose={() => {}} onComplete={() => {}} detectKernels={async () => detections} createNode={createNode} deployNode={deployNode} />);

    fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '重试节点' } });
    fireEvent.change(screen.getByLabelText('主机地址'), { target: { value: 'retry.example.com' } });
    fireEvent.change(screen.getByLabelText('地域标签'), { target: { value: 'SG' } });
    fireEvent.change(screen.getByLabelText('SSH 密码'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '检测内核' }));
    await screen.findByText('选择监听内核');
    fireEvent.click(screen.getByRole('checkbox', { name: /Sing-Box/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认并部署' }));

    expect(await screen.findByText('节点已创建，部署启动失败，可重试')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '重试部署' }));
    await waitFor(() => expect(deployNode).toHaveBeenCalledTimes(2));
    expect(createNode).toHaveBeenCalledOnce();
    expect(deployNode).toHaveBeenNthCalledWith(1, 'node-retry', [{ type: 'sing-box', configPath: '/etc/sing-box/config.json' }]);
    expect(deployNode).toHaveBeenNthCalledWith(2, 'node-retry', [{ type: 'sing-box', configPath: '/etc/sing-box/config.json' }]);
  });

  it('single-flights duplicate detection and confirmation events', async () => {
    const { AddNodeForm } = await import('@/components/cluster/AddNodeForm');
    const detection = deferred<typeof detections>();
    const deployment = deferred<{ success: boolean; timestamp: string }>();
    const detectKernels = vi.fn(() => detection.promise);
    const createNode = vi.fn(async () => ({ success: true, data: { id: 'node-lock' }, timestamp: '' }));
    const deployNode = vi.fn(() => deployment.promise);
    render(<AddNodeForm isOpen onClose={() => {}} onComplete={() => {}} detectKernels={detectKernels} createNode={createNode} deployNode={deployNode} />);

    fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '锁测试' } });
    fireEvent.change(screen.getByLabelText('主机地址'), { target: { value: 'lock.example.com' } });
    fireEvent.change(screen.getByLabelText('地域标签'), { target: { value: 'JP' } });
    fireEvent.change(screen.getByLabelText('SSH 密码'), { target: { value: 'secret' } });
    const form = screen.getByRole('button', { name: '检测内核' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(detectKernels).toHaveBeenCalledOnce();
    detection.resolve(detections);
    await screen.findByText('选择监听内核');
    fireEvent.click(screen.getByRole('checkbox', { name: /Sing-Box/ }));
    const confirm = screen.getByRole('button', { name: '确认并部署' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(deployNode).toHaveBeenCalledOnce());
    expect(createNode).toHaveBeenCalledOnce();
    deployment.resolve({ success: true, timestamp: '' });
  });

  it('invalidates late detection and clears sensitive state when externally closed', async () => {
    const { AddNodeForm } = await import('@/components/cluster/AddNodeForm');
    const detection = deferred<typeof detections>();
    const detectKernels = vi.fn(() => detection.promise);
    const props = { onClose: vi.fn(), onComplete: vi.fn(), detectKernels, createNode: vi.fn(), deployNode: vi.fn() };
    const { rerender } = render(<AddNodeForm isOpen {...props} />);
    fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '敏感节点' } });
    fireEvent.change(screen.getByLabelText('主机地址'), { target: { value: 'secret.example.com' } });
    fireEvent.change(screen.getByLabelText('地域标签'), { target: { value: 'US' } });
    fireEvent.change(screen.getByLabelText('SSH 密码'), { target: { value: 'top-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '检测内核' }));
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<AddNodeForm isOpen={false} {...props} />);
    detection.resolve(detections);
    await Promise.resolve();
    rerender(<AddNodeForm isOpen {...props} />);
    expect((screen.getByLabelText('节点名称') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('SSH 密码') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('选择监听内核')).toBeNull();
  });

  it('ignores a late private-key FileReader result after close and reopen', async () => {
    const { AddNodeForm } = await import('@/components/cluster/AddNodeForm');
    const originalFileReader = globalThis.FileReader;
    const readers: Array<{ result: string; onload: ((event: ProgressEvent<FileReader>) => void) | null }> = [];
    class DeferredFileReader {
      result = 'old-private-key';
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      readAsText() { readers.push(this); }
    }
    globalThis.FileReader = DeferredFileReader as unknown as typeof FileReader;
    try {
      const props = { onClose: vi.fn(), onComplete: vi.fn() };
      const { rerender } = render(<AddNodeForm isOpen {...props} />);
      fireEvent.click(screen.getByRole('button', { name: '私钥' }));
      fireEvent.change(screen.getByLabelText('SSH 私钥文件'), {
        target: { files: [new File(['old-private-key'], 'old_id_ed25519')] },
      });
      expect(readers).toHaveLength(1);

      rerender(<AddNodeForm isOpen={false} {...props} />);
      rerender(<AddNodeForm isOpen {...props} />);
      fireEvent.click(screen.getByRole('button', { name: '私钥' }));
      await act(async () => readers[0].onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>));
      expect(screen.queryByText('old_id_ed25519')).toBeNull();
    } finally {
      globalThis.FileReader = originalFileReader;
    }
  });
});

describe('DeployProgressDialog', () => {
  it('should render progress with DeployStatus', async () => {
    const { DeployProgressDialog } = await import('@/components/cluster/DeployProgressDialog');
    const status = {
      nodeId: 'node-sg',
      deploymentId: 'deploy-sg',
      step: 'bun' as const,
      status: 'running' as const,
      message: '安装 Bun...',
      progress: 40,
      startedAt: Date.now(),
    };
    render(
      React.createElement(DeployProgressDialog, {
        isOpen: true,
        nodeName: '新加坡',
        status,
        onClose: () => {},
      })
    );
    expect(screen.getByText('正在部署 新加坡')).toBeDefined();
    expect(screen.getByText('安装 Bun...')).toBeDefined();
  });
});
