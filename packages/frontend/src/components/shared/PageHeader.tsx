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
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>{description} <abbr tabIndex={0} title="服务器：运行 Agent 的 VPS；协议内核：sing-box、Xray 或 V2Ray；代理节点：客户端中的一条线路；订阅文件：clash.yaml、subscription.txt 和 raw.txt。">术语说明</abbr></p>
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </header>
  )
}
