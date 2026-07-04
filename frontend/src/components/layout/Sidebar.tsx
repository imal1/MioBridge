import Link from 'next/link'
import { useRouter } from 'next/router'
import { memo, useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import ThemeToggle from '@/components/ThemeToggle'
import { apiService } from '@/lib/api'
import { NAV_ITEMS, type NavIcon } from './navigation'

const ICONS: Record<NavIcon, string> = {
  overview: 'ph:gauge-light',
  subscription: 'ph:arrows-clockwise-light',
  nodes: 'ph:hard-drives-light',
  deploy: 'ph:paper-plane-tilt-light',
  logs: 'ph:terminal-window-light',
  config: 'ph:sliders-horizontal-light',
  api: 'ph:globe-hemisphere-west-light',
}

function NavItem({ href, icon, label, active }: { href: string; icon: NavIcon; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className="group relative flex h-11 items-center gap-3 rounded-full px-3 text-sm font-medium transition-[transform,background-color,color,box-shadow] duration-700 ease-[var(--motion)] active:scale-[0.985]"
      style={{
        background: active ? 'var(--sidebar-accent)' : 'transparent',
        color: active ? 'var(--sidebar-accent-foreground)' : 'var(--sidebar-foreground)',
        boxShadow: active ? '0 18px 42px rgba(63, 143, 95, .22)' : 'none',
      }}
    >
      <span
        className="grid h-5 w-5 place-items-center rounded-md border transition-transform duration-700 ease-[var(--motion)] group-hover:translate-x-0.5"
        style={{
          borderColor: active ? 'rgba(255,255,255,.34)' : 'var(--sidebar-border)',
          background: active ? 'rgba(255,255,255,.12)' : 'transparent',
        }}
      >
        <Icon icon={ICONS[icon]} className="h-4 w-4" />
      </span>
      <span>{label}</span>
    </Link>
  )
}

const Sidebar = memo(function Sidebar() {
  const router = useRouter()
  const [mihomoAvailable, setMihomoAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    apiService.getStatus()
      .then(status => {
        if (active) setMihomoAvailable(Boolean(status.mihomoAvailable))
      })
      .catch(() => {
        if (active) setMihomoAvailable(false)
      })
    return () => { active = false }
  }, [])

  return (
    <aside
      className="fixed bottom-[var(--desktop-sidebar-gap)] left-[var(--desktop-sidebar-gap)] top-[var(--desktop-sidebar-gap)] z-20 flex w-[var(--desktop-sidebar-width)] flex-col rounded-[32px] border p-[18px]"
      style={{
        background: 'var(--sidebar)',
        borderColor: 'var(--sidebar-border)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), var(--shadow-elevated)',
        backdropFilter: 'blur(18px)',
      }}
    >
      <Link href="/" className="mb-8 flex items-center gap-3">
        <span
          className="grid h-10 w-10 place-items-center rounded-2xl border"
          style={{
            borderColor: 'var(--sidebar-border)',
            background: 'var(--muted)',
            color: 'var(--sidebar-primary)',
          }}
        >
          <Icon icon="ph:wave-sine-light" className="h-6 w-6" />
        </span>
        <span
          className="text-[24px] font-black leading-[0.92] tracking-normal text-sidebar-foreground"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Mio<br />Bridge
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-2">
        {NAV_ITEMS.map(item => (
          <NavItem
            key={item.href}
            {...item}
            active={router.pathname === item.href}
          />
        ))}
      </nav>

      <div className="space-y-3">
        <div
          className="rounded-[22px] border px-4 py-3 text-xs"
          style={{
            borderColor: 'var(--sidebar-border)',
            background: 'var(--surface-container-low)',
            color: 'var(--muted-foreground)',
          }}
        >
          mihomo 状态<br />
          <span className={`signal-mono ${mihomoAvailable ? 'signal-success' : mihomoAvailable === false ? 'text-danger' : ''}`}>
            {mihomoAvailable === null ? 'checking' : mihomoAvailable ? 'available' : 'unavailable'}
          </span>
        </div>
        <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span>主题</span>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  )
})

export default Sidebar
