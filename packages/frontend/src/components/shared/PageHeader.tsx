import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description: ReactNode
  actions?: ReactNode
}

/** Compact redesign page header: dense h1 + muted lead + right-aligned pill actions. */
export default function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-[18px] flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-.01em', color: 'var(--foreground)' }}>
          {title}
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </header>
  )
}
