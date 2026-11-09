import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import qrcode from 'qrcode-generator';

export function SubscriptionLinks() {
  const [session, setSession] = useState<{ subscriptionToken: string; subscriptionRequired: boolean; publicBaseUrl: string }>();
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/auth/session', { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error('无法读取订阅地址');
      setSession(await response.json());
    }).catch(error => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : '无法读取订阅地址'); });
    return () => abort.abort();
  }, []);
  if (error) return <p role="alert">{error}</p>;
  if (!session) return null;
  const base = session.publicBaseUrl || window.location.origin;
  const url = (file: string) => `${base.replace(/\/$/, '')}/${file}${session.subscriptionRequired ? `?token=${encodeURIComponent(session.subscriptionToken)}` : ''}`;
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/.test(new URL(base).hostname);
  return <section className="mb-card p-4"><h2 className="mb-2 font-semibold">我的订阅</h2>
    {local && <p>当前地址可能无法从客户端访问，请在<Link to="/config">配置页设置公网地址</Link>。</p>}
    {([['Clash / mihomo', 'clash.yaml'], ['通用 Base64', 'subscription.txt'], ['原始链接', 'raw.txt']] as const).map(([name, file]) => <div key={file} className="my-2 flex flex-wrap items-center gap-2">
      <label>{name}<input aria-label={`${name}订阅地址`} readOnly value={url(file)} className="mx-2 w-56 max-w-full rounded border p-1" /></label>
      <button className="mb-pill-btn" onClick={async () => { try { await navigator.clipboard.writeText(url(file)); toast.success('地址已复制'); } catch { toast.error('复制失败，请手动复制地址'); } }}>复制</button>
      <button className="mb-pill-btn" onClick={() => {
        try { const code = qrcode(0, 'M'); code.addData(url(file)); code.make(); setQr(code.createDataURL(4, 16)); }
        catch { toast.error('地址过长，无法生成二维码'); }
      }}>二维码</button>
    </div>)}
    <div className="flex flex-wrap gap-3">
      {(['Clash Verge', 'FlClash', 'Stash', 'Shadowrocket', 'v2rayN'] as const).map(client => {
        const prefix = { 'Clash Verge': 'clash://install-config?url=', FlClash: 'clash://install-config?url=', Stash: 'stash://install-config?url=', Shadowrocket: 'sub://', v2rayN: 'v2rayn://install-config?url=' }[client];
        const target = url(client === 'Shadowrocket' || client === 'v2rayN' ? 'subscription.txt' : 'clash.yaml');
        return <a key={client} href={`${prefix}${client === 'Shadowrocket' ? btoa(target) : encodeURIComponent(target)}`}>导入 {client}</a>;
      })}
    </div>
    {qr && <div><img src={qr} width={240} height={240} alt="订阅地址二维码" /><button onClick={() => setQr('')}>关闭二维码</button></div>}
  </section>;
}
