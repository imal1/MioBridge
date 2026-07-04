import { useRouter } from 'next/router'
import { Icon } from '@iconify/react'
import ThemeToggle from '@/components/ThemeToggle'
import { useAppContext } from '@/context/AppContext'
import { PAGE_TITLES } from './navigation'

export default function MobileHeader() {
  const { setMobileDrawerOpen } = useAppContext()
  const router = useRouter()
  const title = PAGE_TITLES[router.pathname] ?? 'MioBridge'

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between px-4"
      style={{
        height: '56px',
        background: 'var(--surface)',
        boxShadow: 'var(--shadow-elevated)',
        backdropFilter: 'blur(18px)',
      }}
    >
      <button
        onClick={() => setMobileDrawerOpen(true)}
        className="p-2 -ml-1 rounded-lg transition-[transform,background-color] duration-700 ease-[var(--motion)]"
        style={{ color: 'var(--foreground)', background: 'transparent', border: 'none', cursor: 'pointer' }}
        aria-label="打开菜单"
      >
        <Icon icon="ph:list-light" className="w-5 h-5" />
      </button>

      <div className="flex items-center gap-1.5">
        <Icon icon="ph:wave-sine-light" className="w-4 h-4" style={{ color: 'var(--primary)' }} />
        <span
          className="font-semibold text-sm"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--foreground)' }}
        >
          {title}
        </span>
      </div>

      <ThemeToggle />
    </header>
  )
}
