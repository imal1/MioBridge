"use client";

import { useState } from 'react';
import { Icon } from '@iconify/react';

interface AddNodeFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: NodeFormData) => void;
}

export interface NodeFormData {
  name: string;
  host: string;
  kernel: 'sing-box' | 'xray' | 'v2ray';
  location: string;
  sshUser: string;
  sshAuthMethod: 'password' | 'privateKey';
  sshPassword?: string;
  sshPrivateKey?: string;
  sshPrivateKeyName?: string;
}

export function AddNodeForm({ isOpen, onClose, onSubmit }: AddNodeFormProps) {
  const [form, setForm] = useState<NodeFormData>({
    name: '', host: '',
    kernel: 'sing-box', location: '',
    sshUser: 'root', sshAuthMethod: 'password', sshPassword: '',
    sshPrivateKey: '', sshPrivateKeyName: '',
  });
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const update = (field: keyof NodeFormData, value: string | number) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      onSubmit({
        name: form.name,
        host: form.host,
        kernel: form.kernel,
        location: form.location,
        sshUser: form.sshUser,
        sshAuthMethod: form.sshAuthMethod,
        ...(form.sshAuthMethod === 'password'
          ? { sshPassword: form.sshPassword }
          : { sshPrivateKey: form.sshPrivateKey, sshPrivateKeyName: form.sshPrivateKeyName }),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const selectAuthMethod = (sshAuthMethod: NodeFormData['sshAuthMethod']) => {
    setForm(prev => ({
      ...prev,
      sshAuthMethod,
      sshPassword: '',
      sshPrivateKey: '',
      sshPrivateKeyName: '',
    }));
  };

  const uploadPrivateKey = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm(prev => ({
      ...prev,
      sshPrivateKey: typeof reader.result === 'string' ? reader.result : '',
      sshPrivateKeyName: file.name,
    }));
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="garden-card p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
            添加节点
          </h3>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-[var(--muted)]">
            <Icon icon="ph:x-bold" className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Node info */}
          <div>
            <label className="text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>节点名称</label>
            <input type="text" value={form.name} onChange={e => update('name', e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-2xl text-sm"
              style={{ backgroundColor: 'var(--surface-container-lowest)', color: 'var(--foreground)' }}
              placeholder="如: 新加坡" required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>主机地址</label>
              <input type="text" value={form.host} onChange={e => update('host', e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-2xl text-sm"
                style={{ backgroundColor: 'var(--surface-container-lowest)', color: 'var(--foreground)' }}
                placeholder="sg.example.com" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>内核类型</label>
              <select value={form.kernel} onChange={e => update('kernel', e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-2xl text-sm"
                style={{ backgroundColor: 'var(--surface-container-lowest)', color: 'var(--foreground)' }}>
                <option value="sing-box">Sing-Box</option>
                <option value="xray">Xray</option>
                <option value="v2ray">V2Ray</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>地域标签</label>
              <input type="text" value={form.location} onChange={e => update('location', e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-2xl text-sm"
                style={{ backgroundColor: 'var(--surface-container-lowest)', color: 'var(--foreground)' }}
                placeholder="如: 东京" required />
            </div>
          </div>

          <div className="h-2" />

          {/* SSH info */}
          <h4 className="text-sm font-semibold" style={{ color: 'var(--muted-foreground)' }}>SSH 连接信息</h4>

          <div className="flex gap-2" aria-label="SSH 认证方式">
            <button type="button" onClick={() => selectAuthMethod('password')}
              className="px-3 py-2 rounded-lg text-sm font-medium"
              style={{ backgroundColor: form.sshAuthMethod === 'password' ? 'var(--primary)' : 'var(--secondary)', color: form.sshAuthMethod === 'password' ? 'var(--primary-foreground)' : 'var(--secondary-foreground)' }}>
              密码
            </button>
            <button type="button" onClick={() => selectAuthMethod('privateKey')}
              className="px-3 py-2 rounded-lg text-sm font-medium"
              style={{ backgroundColor: form.sshAuthMethod === 'privateKey' ? 'var(--primary)' : 'var(--secondary)', color: form.sshAuthMethod === 'privateKey' ? 'var(--primary-foreground)' : 'var(--secondary-foreground)' }}>
              私钥
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>SSH 用户</label>
              <input type="text" value={form.sshUser} onChange={e => update('sshUser', e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-2xl text-sm"
                style={{ backgroundColor: 'var(--surface-container-lowest)', color: 'var(--foreground)' }} />
            </div>
          </div>

          {form.sshAuthMethod === 'password' ? (
            <div>
              <label htmlFor="legacy-ssh-password" className="text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>SSH 密码</label>
              <input id="legacy-ssh-password" type="password" value={form.sshPassword} onChange={e => update('sshPassword', e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--surface-container-lowest)', color: 'var(--foreground)' }}
                placeholder="SSH 登录密码" required />
            </div>
          ) : (
            <div>
              <label htmlFor="legacy-ssh-private-key" className="text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>SSH 私钥文件</label>
              <input id="legacy-ssh-private-key" type="file" onChange={e => uploadPrivateKey(e.target.files?.[0])}
                className="w-full mt-1 px-3 py-2 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--surface-container-lowest)', color: 'var(--foreground)' }} required />
              {form.sshPrivateKeyName ? <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>{form.sshPrivateKeyName}</p> : null}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={submitting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-[0.98]"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)', opacity: submitting ? 0.6 : 1 }}>
              <Icon icon={submitting ? 'ph:spinner-bold' : 'ph:plus-circle-bold'} className={`w-4 h-4 ${submitting ? 'animate-spin' : ''}`} />
              添加节点
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{ backgroundColor: 'var(--secondary)', color: 'var(--secondary-foreground)' }}>
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
