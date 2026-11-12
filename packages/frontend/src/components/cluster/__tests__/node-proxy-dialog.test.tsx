// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NodeProxyDialog } from '@/components/cluster/NodeProxyDialog';

describe('NodeProxyDialog', () => {
  it('emits only the explicitly chosen settings and keeps the Agent address out of the payload', () => {
    const onSave = vi.fn();
    render(<NodeProxyDialog open nodeName="HT" host="203.0.113.7" onCancel={() => {}} onSave={onSave} />);

    expect(screen.getByText(/不会改动 Agent 管理地址 203\.0\.113\.7/)).toBeDefined();
    expect(screen.getByRole('button', { name: '沿用内核' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.change(screen.getByLabelText('连接域名'), { target: { value: ' ht.example.com ' } });
    fireEvent.change(screen.getByLabelText('TLS SNI'), { target: { value: 'ht.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '严格校验' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hysteria2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trojan' }));
    fireEvent.change(screen.getByLabelText('订阅显示名称'), { target: { value: 'HT' } });
    fireEvent.click(screen.getByRole('button', { name: '保存出口设置' }));

    expect(onSave).toHaveBeenCalledWith({
      server: 'ht.example.com', sni: 'ht.example.com', certVerify: 'strict',
      protocols: ['trojan', 'hysteria2'], displayName: 'HT',
    });
  });

  it('prefills the persisted settings and clears them with null when every field is emptied', () => {
    const onSave = vi.fn();
    render(<NodeProxyDialog open nodeName="HT" proxy={{ server: 'ht.example.com', certVerify: 'insecure', protocols: ['trojan'], displayName: 'HT' }} onCancel={() => {}} onSave={onSave} />);

    expect((screen.getByLabelText('连接域名') as HTMLInputElement).value).toBe('ht.example.com');
    expect(screen.getByRole('button', { name: '跳过校验' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Trojan' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.change(screen.getByLabelText('连接域名'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '沿用内核' }));
    fireEvent.change(screen.getByLabelText('订阅显示名称'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存出口设置' }));
    // 协议范围在没有域名 / SNI / 校验策略时没有意义，不应单独落盘。
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it('surfaces server-side validation errors without closing', () => {
    render(<NodeProxyDialog open nodeName="HT" error="连接域名必须是有效的域名或 IP 地址" onCancel={() => {}} onSave={() => {}} />);
    expect(screen.getByText('连接域名必须是有效的域名或 IP 地址')).toBeDefined();
  });
});
