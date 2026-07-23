import { memo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { useTheme } from '@/components/ThemeProvider'
import { useStatus, useClusterStatus } from '@/lib/queries'
import { NAV_MAIN, NAV_SYSTEM, NAV_ICONS, type NavItem } from './navigation'

function NavButton({ item, active, iconSize }: { item: NavItem; active: boolean; iconSize: number }) {
  return (
    <Link to={item.href} className={`mb-nav-btn${active ? ' active' : ''}`}>
      <Icon icon={NAV_ICONS[item.icon]} style={{ fontSize: iconSize }} />
      <span>{item.label}</span>
      {item.badge ? (
        <span
          className="signal-mono"
          style={{
            marginLeft: 'auto', fontSize: 10.5, padding: '1px 7px', borderRadius: 99,
            background: active ? 'rgba(255,255,255,.16)' : 'var(--card2)',
            color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
          }}
        >
          {item.badge}
        </span>
      ) : null}
    </Link>
  )
}

const Sidebar = memo(function Sidebar() {
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  // 与 Dashboard 共享 key，常驻侧栏与当前页合并为单次请求。
  const status = useStatus()
  const cluster = useClusterStatus()

  const mihomoAvailable: boolean | null = status.isPending
    ? null
    : status.isError
      ? false
      : Boolean(status.data?.mihomoAvailable)
  const mihomoVersion = status.data?.mihomoVersion
  const nodeCount = cluster.data?.nodes?.length

  const mainItems: NavItem[] = NAV_MAIN.map(it =>
    it.icon === 'nodes' && nodeCount ? { ...it, badge: String(nodeCount) } : it,
  )

  return (
    <aside className="mb-sidebar">
      <Link to="/" className="mb-5 flex items-center gap-2.5 px-1.5 no-underline hover:no-underline">
        <span
          className="grid place-items-center"
          style={{
            width: 32, height: 32, borderRadius: 10, border: '1px solid var(--border)',
            background: 'var(--card2)', color: 'var(--primary)',
          }}
        >
          <Icon icon="ph:wave-sine-light" style={{ fontSize: 19 }} />
        </span>
        <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-.01em', color: 'var(--foreground)' }}>
          MioBridge
        </span>
      </Link>

      <nav className="flex flex-col gap-[3px]">
        {mainItems.map(item => (
          <NavButton key={item.href} item={item} active={location.pathname === item.href} iconSize={16} />
        ))}
      </nav>

      <div className="mt-[18px] border-t px-2 pb-1 pt-2.5" style={{ borderColor: 'var(--border)' }}>
        <p
          className="mx-1.5 mb-1.5"
          style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', color: 'var(--muted-foreground)' }}
        >
          系统
        </p>
        <nav className="flex flex-col gap-0.5">
          {NAV_SYSTEM.map(item => (
            <NavButton key={item.href} item={item} active={location.pathname === item.href} iconSize={15} />
          ))}
        </nav>
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <div
          className="flex items-center gap-2"
          style={{
            padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10,
            background: 'var(--card2)', fontSize: 11.5, color: 'var(--muted-foreground)',
          }}
        >
          <span
            style={{
              width: 7, height: 7, borderRadius: 99,
              background: mihomoAvailable === false ? 'var(--danger)' : 'var(--primary)',
              animation: mihomoAvailable ? 'signal-pulse 2.4s infinite' : 'none',
            }}
          />
          mihomo{' '}
          <span
            className="signal-mono"
            style={{ color: mihomoAvailable === false ? 'var(--danger)' : 'var(--primary)' }}
          >
            {mihomoAvailable === null ? 'checking' : mihomoAvailable ? 'available' : 'unavailable'}
          </span>
          {mihomoVersion ? (
            <span className="signal-mono" style={{ marginLeft: 'auto' }}>{mihomoVersion}</span>
          ) : null}
        </div>
        <button
          onClick={toggleTheme}
          className="mb-nav-btn"
          style={{ height: 30, border: '1px solid var(--border)', borderRadius: 10, fontSize: 11.5, fontWeight: 400, color: 'var(--muted-foreground)' }}
        >
          <Icon icon={isDark ? 'ph:sun-light' : 'ph:moon-light'} style={{ fontSize: 14 }} />
          {isDark ? '浅色模式' : '深色模式'}
        </button>
      </div>
    </aside>
  )
})

export default Sidebar
