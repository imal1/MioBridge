"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { apiService } from '@/lib/api';
import type { KernelDetection } from '@/server/services/deployManager';
import type { KernelType, NodeKernelConfig, SshAuthMethod } from '@/server/types';
import { KernelDetectionDialog } from './KernelDetectionDialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface NodeFormData {
  name: string;
  host: string;
  location: string;
  sshUser: string;
  sshAuthMethod: SshAuthMethod;
  sshPassword?: string;
  sshPrivateKey?: string;
  sshPrivateKeyName?: string;
}

type DetectKernels = typeof apiService.detectKernels;
type CreateNode = typeof apiService.addNode;
type DeployNode = typeof apiService.deployNode;

interface AddNodeFormProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void | Promise<void>;
  monitoredTypes?: KernelType[];
  detectKernels?: DetectKernels;
  createNode?: CreateNode;
  deployNode?: DeployNode;
}

const EMPTY_FORM: NodeFormData = {
  name: '', host: '', location: '', sshUser: 'root', sshAuthMethod: 'password',
  sshPassword: '', sshPrivateKey: '', sshPrivateKeyName: '',
};

export function AddNodeForm({
  isOpen,
  onClose,
  onComplete,
  monitoredTypes = [],
  detectKernels = payload => apiService.detectKernels(payload),
  createNode = payload => apiService.addNode(payload),
  deployNode = (nodeId, kernels) => apiService.deployNode(nodeId, kernels),
}: AddNodeFormProps) {
  const [form, setForm] = useState<NodeFormData>(EMPTY_FORM);
  const [detections, setDetections] = useState<KernelDetection[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detectLockRef = useRef(false);
  const submitLockRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const createdNodeIdRef = useRef<string | null>(null);
  const formOpenRef = useRef(isOpen);
  formOpenRef.current = isOpen;

  const reset = useCallback(() => {
    requestGenerationRef.current += 1;
    detectLockRef.current = false;
    submitLockRef.current = false;
    createdNodeIdRef.current = null;
    setForm(EMPTY_FORM);
    setDetections(null);
    setDetecting(false);
    setSubmitting(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!isOpen) reset();
  }, [isOpen, reset]);

  if (!isOpen) return null;

  const update = (field: keyof NodeFormData, value: string) => {
    setForm(previous => ({ ...previous, [field]: value }));
  };

  const authPayload = () => ({
    host: form.host,
    user: form.sshUser,
    authMethod: form.sshAuthMethod,
    ...(form.sshAuthMethod === 'password'
      ? { password: form.sshPassword }
      : { privateKey: form.sshPrivateKey }),
  });

  const handleDetect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (detectLockRef.current) return;
    detectLockRef.current = true;
    const generation = requestGenerationRef.current;
    setDetecting(true);
    setError(null);
    try {
      const result = await detectKernels({ ssh: authPayload() });
      if (requestGenerationRef.current === generation) setDetections(result);
    } catch (caught) {
      if (requestGenerationRef.current === generation) {
        setError(caught instanceof Error ? caught.message : '内核检测失败');
      }
    } finally {
      if (requestGenerationRef.current === generation) {
        detectLockRef.current = false;
        setDetecting(false);
      }
    }
  };

  const handleConfirm = async (kernels: NodeKernelConfig[]) => {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    const generation = requestGenerationRef.current;
    setSubmitting(true);
    setError(null);
    try {
      let nodeId = createdNodeIdRef.current;
      if (!nodeId) {
        const result = await createNode({
          name: form.name,
          host: form.host,
          kernels,
          location: form.location,
          sshUser: form.sshUser,
          sshAuthMethod: form.sshAuthMethod,
          ...(form.sshAuthMethod === 'password'
            ? { sshPassword: form.sshPassword }
            : { sshPrivateKey: form.sshPrivateKey, sshPrivateKeyName: form.sshPrivateKeyName }),
        });
        if (!result.success || !result.data?.id) throw new Error(result.error || '添加节点失败');
        nodeId = result.data.id;
        if (requestGenerationRef.current === generation) createdNodeIdRef.current = nodeId;
      }
      const deployment = await deployNode(nodeId, kernels);
      if (!deployment.success) throw new Error(deployment.error || '启动部署失败');
      if (requestGenerationRef.current === generation) {
        reset();
        await onComplete();
      }
    } catch (caught) {
      if (requestGenerationRef.current === generation) {
        setError(createdNodeIdRef.current
          ? '节点已创建，部署启动失败，可重试'
          : caught instanceof Error ? caught.message : '添加节点失败');
      }
    } finally {
      if (requestGenerationRef.current === generation) {
        submitLockRef.current = false;
        setSubmitting(false);
      }
    }
  };

  const requestClose = () => {
    if (detectLockRef.current || submitLockRef.current) return;
    reset();
    onClose();
  };

  const selectAuthMethod = (sshAuthMethod: SshAuthMethod) => {
    setForm(previous => ({
      ...previous,
      sshAuthMethod,
      sshPassword: '',
      sshPrivateKey: '',
      sshPrivateKeyName: '',
    }));
  };

  const uploadPrivateKey = (file?: File) => {
    if (!file) return;
    const generation = requestGenerationRef.current;
    const reader = new FileReader();
    reader.onload = () => {
      if (requestGenerationRef.current !== generation || !formOpenRef.current) return;
      setForm(previous => ({
        ...previous,
        sshPrivateKey: typeof reader.result === 'string' ? reader.result : '',
        sshPrivateKeyName: file.name,
      }));
    };
    reader.readAsText(file);
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={open => { if (!open && !detections) requestClose(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleDetect}>
            <DialogHeader>
              <DialogTitle>添加节点</DialogTitle>
              <DialogDescription>填写连接信息后先检测远端内核，再选择需要监听的内核。</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {error && !detections ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
              <div className="grid gap-2">
                <Label htmlFor="node-name">节点名称</Label>
                <Input id="node-name" name="name" autoComplete="off" value={form.name} onChange={event => update('name', event.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="node-host">主机地址</Label>
                <Input id="node-host" name="host" autoComplete="off" inputMode="url" value={form.host} onChange={event => update('host', event.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="node-location">地域标签</Label>
                <Input id="node-location" name="location" autoComplete="off" value={form.location} onChange={event => update('location', event.target.value)} required />
              </div>
              <h4 className="text-sm font-semibold text-muted-foreground">SSH 连接信息</h4>
              <div className="grid gap-2">
                <Label htmlFor="ssh-user">SSH 用户</Label>
                <Input id="ssh-user" name="sshUser" autoComplete="username" value={form.sshUser} onChange={event => update('sshUser', event.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label>SSH 认证</Label>
                <div aria-label="SSH 认证方式" className="flex gap-2">
                  <Button type="button" size="sm" variant={form.sshAuthMethod === 'password' ? 'default' : 'outline'} onClick={() => selectAuthMethod('password')}>密码</Button>
                  <Button type="button" size="sm" variant={form.sshAuthMethod === 'privateKey' ? 'default' : 'outline'} onClick={() => selectAuthMethod('privateKey')}>私钥</Button>
                </div>
              </div>
              {form.sshAuthMethod === 'password' ? (
                <div className="grid gap-2">
                  <Label htmlFor="ssh-password">SSH 密码</Label>
                  <Input id="ssh-password" name="sshPassword" type="password" autoComplete="new-password" value={form.sshPassword} onChange={event => update('sshPassword', event.target.value)} required />
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="ssh-private-key">SSH 私钥文件</Label>
                  <Input id="ssh-private-key" name="sshPrivateKey" type="file" autoComplete="off" onChange={event => uploadPrivateKey(event.target.files?.[0])} required />
                  {form.sshPrivateKeyName ? <p className="text-sm text-muted-foreground">{form.sshPrivateKeyName}</p> : null}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={detecting} onClick={requestClose}>取消</Button>
              <Button type="submit" disabled={detecting}>
                <Icon icon={detecting ? 'ph:spinner-bold' : 'ph:magnifying-glass-bold'} className={detecting ? 'animate-spin' : ''} />
                检测内核
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {detections ? (
        <KernelDetectionDialog
          key={`${detections.map(item => `${item.type}:${item.installed}:${item.defaultConfigPath}`).join('|')}::${monitoredTypes.join('|')}`}
          open
          detections={detections}
          monitoredTypes={monitoredTypes}
          submitting={submitting}
          error={error}
          confirmLabel={createdNodeIdRef.current ? '重试部署' : '确认并部署'}
          onCancel={() => setDetections(null)}
          onConfirm={handleConfirm}
        />
      ) : null}
    </>
  );
}
