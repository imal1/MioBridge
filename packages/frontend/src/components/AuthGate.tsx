import { useEffect, useState, type ReactNode } from 'react';

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'login' | 'ready' | 'error'>('loading');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [protectedSubscription, setProtectedSubscription] = useState(true);
  const check = async () => {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) { setState('login'); return; }
      if (!response.ok) throw new Error('无法连接控制台');
      const data = await response.json();
      setProtectedSubscription(data.subscriptionRequired !== false);
      setState('ready');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '无法连接控制台'); setState('error'); }
  };
  useEffect(() => { void check(); const expired = () => setState('login'); window.addEventListener('miobridge:unauthorized', expired); return () => window.removeEventListener('miobridge:unauthorized', expired); }, []);
  if (state === 'loading') return <main className="p-8">正在连接控制台…</main>;
  if (state === 'error') return <main className="p-8"><p role="alert">{error}</p><button onClick={() => void check()}>重试</button></main>;
  if (state === 'login') return <main className="mx-auto max-w-md p-8"><h1>登录 MioBridge</h1><p>在服务器运行 <code>miobridge auth show</code> 获取管理员令牌。</p>
    <form onSubmit={async event => {
      event.preventDefault(); setError('');
      try {
        const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        if (!response.ok) throw new Error(response.status === 429 ? '尝试次数过多，请稍后重试' : '登录令牌无效');
        setToken(''); await check();
      } catch (caught) { setError(caught instanceof Error ? caught.message : '登录失败'); }
    }}><label>管理员令牌<input className="w-full rounded border p-2" type="password" autoComplete="current-password" value={token} onChange={event => setToken(event.target.value)} required /></label>
      <button className="mb-pill-btn primary mt-4" type="submit">登录</button>{error && <p role="alert">{error}</p>}
    </form></main>;
  return <>{!protectedSubscription && <aside role="status" className="border p-3 lg:ml-[212px]" style={{ background: 'var(--warning-bg)' }}>订阅未加令牌。开启后请为客户端复制新地址。<button onClick={async () => {
    if (!window.confirm('开启后旧订阅地址将失效。确认开启并更新客户端地址？')) return;
    const response = await fetch('/api/auth/subscription', { method: 'POST' });
    if (response.ok) { await check(); window.location.assign('/subscription'); }
  }}>开启订阅令牌</button></aside>}{children}</>;
}
