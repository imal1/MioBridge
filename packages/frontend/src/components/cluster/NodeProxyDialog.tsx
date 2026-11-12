import { useState } from 'react';
import {
  NODE_PROXY_PROTOCOLS, type NodeCertVerify, type NodeProxyConfig, type NodeProxyProtocol,
} from '@/lib/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const PROTOCOL_LABELS: Record<NodeProxyProtocol, string> = {
  vless: 'VLESS', vmess: 'VMess', trojan: 'Trojan', hysteria2: 'Hysteria2', tuic: 'TUIC', ss: 'Shadowsocks',
};
const VERIFY_OPTIONS: Array<{ value: NodeCertVerify | ''; label: string; hint: string }> = [
  { value: '', label: '沿用内核', hint: '保持内核导出的校验参数，不做任何推断。' },
  { value: 'strict', label: '严格校验', hint: '导出 skip-cert-verify: false。证书必须受信任，且与连接域名或 SNI 匹配。' },
  { value: 'insecure', label: '跳过校验', hint: '导出 skip-cert-verify: true，仅用于自签证书。' },
];

interface NodeProxyDialogProps {
  open: boolean;
  nodeName: string;
  /** Agent 管理地址，仅用于提示它不会被这里的设置改动。 */
  host?: string;
  proxy?: NodeProxyConfig;
  submitting?: boolean;
  error?: string | null;
  onCancel: () => void;
  /** null 表示清除全部出口设置，恢复为内核上报值。 */
  onSave: (proxy: NodeProxyConfig | null) => void;
}

export function NodeProxyDialog({ open, nodeName, host, proxy, submitting = false, error = null, onCancel, onSave }: NodeProxyDialogProps) {
  const [server, setServer] = useState(proxy?.server ?? '');
  const [sni, setSni] = useState(proxy?.sni ?? '');
  const [certVerify, setCertVerify] = useState<NodeCertVerify | ''>(proxy?.certVerify ?? '');
  const [protocols, setProtocols] = useState<Set<NodeProxyProtocol>>(() => new Set(proxy?.protocols ?? []));
  const [displayName, setDisplayName] = useState(proxy?.displayName ?? '');

  const toggleProtocol = (protocol: NodeProxyProtocol) => setProtocols(previous => {
    const next = new Set(previous);
    if (next.has(protocol)) next.delete(protocol);
    else next.add(protocol);
    return next;
  });

  const endpointSet = Boolean(server.trim() || sni.trim() || certVerify);
  const save = () => {
    const selected = NODE_PROXY_PROTOCOLS.filter(protocol => protocols.has(protocol));
    const next: NodeProxyConfig = {
      ...(server.trim() ? { server: server.trim() } : {}),
      ...(sni.trim() ? { sni: sni.trim() } : {}),
      ...(certVerify ? { certVerify } : {}),
      // 协议范围只约束连接域名 / SNI / 证书校验；三者都未设置时它没有意义，不落盘。
      ...(endpointSet && selected.length ? { protocols: selected } : {}),
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
    };
    onSave(Object.keys(next).length ? next : null);
  };

  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen && !submitting) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>订阅出口设置</DialogTitle>
          <DialogDescription>
            {nodeName} 在订阅里如何被客户端连接。只影响生成的订阅产物{host ? `，不会改动 Agent 管理地址 ${host}` : ''}；留空的字段沿用内核上报值，下一次订阅更新时生效。
          </DialogDescription>
        </DialogHeader>
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="proxy-server">连接域名</Label>
            <Input id="proxy-server" value={server} placeholder="例如 node.example.com；留空沿用内核导出的地址" onChange={event => setServer(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="proxy-sni">TLS SNI</Label>
            <Input id="proxy-sni" value={sni} placeholder="留空沿用内核上报值；Reality 与非 TLS 协议不受影响" onChange={event => setSni(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">证书校验</span>
            <div className="flex flex-wrap gap-2">
              {VERIFY_OPTIONS.map(option => (
                <Button key={option.value || 'inherit'} type="button" size="sm" variant={certVerify === option.value ? 'default' : 'outline'} aria-pressed={certVerify === option.value} onClick={() => setCertVerify(option.value)}>{option.label}</Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{VERIFY_OPTIONS.find(option => option.value === certVerify)?.hint}</p>
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">生效协议</span>
            <div className="flex flex-wrap gap-2">
              {NODE_PROXY_PROTOCOLS.map(protocol => (
                <Button key={protocol} type="button" size="sm" variant={protocols.has(protocol) ? 'default' : 'outline'} aria-pressed={protocols.has(protocol)} onClick={() => toggleProtocol(protocol)}>{PROTOCOL_LABELS[protocol]}</Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {protocols.size === 0 ? '未选择 = 对该节点的全部协议生效。' : '连接域名、SNI 与证书校验只应用到选中的协议，其余协议保持内核上报值。'}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="proxy-display-name">订阅显示名称</Label>
            <Input id="proxy-display-name" value={displayName} maxLength={64} placeholder="留空使用「地域标签 + 内核节点名」" onChange={event => setDisplayName(event.target.value)} />
            <p className="text-xs text-muted-foreground">设置后节点导出为「显示名称 + 协议」（如 {displayName.trim() || 'HT'} Trojan），策略组引用随之更新。</p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>取消</Button>
          <Button type="button" disabled={submitting} onClick={save}>保存出口设置</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
