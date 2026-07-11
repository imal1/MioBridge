// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

describe('AddNodeForm', () => {
  it('should render form with required fields', async () => {
    const { AddNodeForm } = await import('@/components/cluster/AddNodeForm');
    render(
      React.createElement(AddNodeForm, {
        isOpen: true,
        onClose: () => {},
        onSubmit: () => {},
      })
    );
    expect(screen.getByText('SSH 连接信息')).toBeDefined();
    expect(screen.getByRole('button', { name: '密码' })).toBeDefined();
    expect(screen.queryByLabelText('SSH 私钥文件')).toBeNull();
  });

  it('uploads a private-key file instead of accepting private-key text', async () => {
    const { AddNodeForm } = await import('@/components/cluster/AddNodeForm');
    const onSubmit = vi.fn();
    render(<AddNodeForm isOpen onClose={() => {}} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: '私钥' }));
    const input = screen.getByLabelText('SSH 私钥文件');
    const file = new File(['private-key-content'], 'id_ed25519');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('id_ed25519')).toBeDefined());
    expect(screen.queryByRole('textbox', { name: 'SSH 私钥' })).toBeNull();
    expect(screen.queryByLabelText('SSH 密码')).toBeNull();
  });
});

describe('DeployProgressDialog', () => {
  it('should render progress with DeployStatus', async () => {
    const { DeployProgressDialog } = await import('@/components/cluster/DeployProgressDialog');
    const status = {
      nodeId: 'node-sg',
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
