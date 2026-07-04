import type { ReactNode } from 'react'

interface SignalPageProps {
  crumb: string
  title: string
  description: string
  status?: string
  actions?: ReactNode
  children: ReactNode
  maxWidth?: 'normal' | 'narrow'
}

export default function SignalPage({
  crumb,
  title,
  description,
  status = '主节点在线',
  actions,
  children,
  maxWidth = 'normal',
}: SignalPageProps) {
  return (
    <div className={`signal-page ${maxWidth === 'narrow' ? 'max-w-[1180px]' : 'max-w-[1440px]'}`}>
      <div className="signal-topbar">
        <div className="signal-crumb">{crumb}</div>
        <div className="signal-status"><span className="signal-dot" />{status}</div>
      </div>
      <header className="signal-head">
        <div>
          <h1 className="signal-title">{title}</h1>
          <p className="signal-lead">{description}</p>
        </div>
        {actions ? <div className="signal-actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  )
}
