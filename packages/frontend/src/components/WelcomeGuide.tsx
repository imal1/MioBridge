import { useState } from 'react';
import { Link } from 'react-router-dom';
import { deployAndWait } from '@/lib/serverSetup';
import { apiService } from '@/lib/api';
import { errorMessage } from '@/lib/errorMessage';
import { SubscriptionLinks } from './SubscriptionLinks';

export default function WelcomeGuide({ visible = true, reopen = false }: { visible?: boolean; reopen?: boolean }) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('miobridge.welcome.v1') === 'done');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  if (!visible || (dismissed && !reopen)) return null;
  const install = async (component: 'agent' | 'mihomo' | 'sing-box') => {
    setBusy(true); setError('');
    try {
      const prepared = await fetch('/api/onboarding/local', { method: 'POST' });
      if (!prepared.ok) throw new Error('无法准备本机档案');
      await deployAndWait('local', component, 'install', setProgress);
      setProgress(`${component} 已准备好`);
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  };
  return <section className="mb-card my-4 space-y-3 p-4" aria-label="首次使用引导"><h2>开始使用 MioBridge</h2>
    <p>MioBridge 汇总已有协议内核的代理链接，生成客户端可以导入的订阅文件。</p>
    <ol className="list-decimal space-y-3 pl-5">
      <li>检查本机：<button className="mb-pill-btn" disabled={busy} onClick={() => void install('mihomo')}>准备 mihomo</button> <button className="mb-pill-btn" disabled={busy} onClick={() => void install('agent')}>准备本机 Agent</button></li>
      <li>准备协议内核：已有 sing-box、Xray 或 V2Ray（233boy 脚本）可直接纳管；没有时可 <button className="mb-pill-btn" disabled={busy} onClick={() => void install('sing-box')}>安装 sing-box</button>，也可跳过本机。</li>
      <li><Link to="/nodes">添加子服务器（可选）</Link>：填写 SSH 连接，确认指纹后自动安装 Agent 并识别协议内核。</li>
      <li><button className="mb-pill-btn primary" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { const result = await apiService.startSubscriptionJob(); if (!result.success) throw new Error(errorMessage(result.error)); setProgress('订阅生成已启动，请在订阅页面查看结果'); }
        catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
      }}>生成订阅</button> <Link to="/subscription">查看生成结果</Link></li>
      <li>复制订阅地址或扫描二维码，在客户端导入。</li>
    </ol>
    {progress && <p role="status">{progress}</p>}{error && <p role="alert">{error}</p>}
    <SubscriptionLinks />
    <button disabled={busy} onClick={() => { localStorage.setItem('miobridge.welcome.v1', 'done'); setDismissed(true); }}>完成引导</button>
  </section>;
}
