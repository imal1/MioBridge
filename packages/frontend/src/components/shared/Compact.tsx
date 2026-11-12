import type { ButtonHTMLAttributes, ReactNode } from 'react';
export function PillButton({ active = false, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button type="button" className={`mb-pill-btn ${active ? 'primary' : ''} ${className}`} {...props} />;
}
export function StatusPill({ tone, children }: { tone: 'success' | 'warning' | 'danger' | 'muted'; children: ReactNode }) {
  return <span style={{ display: 'inline-flex', padding: '2px 9px', borderRadius: 99, background: tone === 'muted' ? 'var(--card2)' : `var(--${tone}-bg)`, color: tone === 'muted' ? 'var(--muted-foreground)' : `var(--${tone})`, fontSize: 11, fontWeight: 600 }}>{children}</span>;
}
export function InfoCell({ label, children }: { label: string; children: ReactNode }) {
  return <div style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--card2)' }}><p style={{ margin: 0, fontSize: 10.5, color: 'var(--muted-foreground)' }}>{label}</p><p style={{ margin: '2px 0 0', fontSize: 12.5, fontWeight: 600 }}>{children}</p></div>;
}
