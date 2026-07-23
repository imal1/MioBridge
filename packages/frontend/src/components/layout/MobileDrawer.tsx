import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import { useAppContext } from '@/context/AppContext'
import ThemeToggle from '@/components/ThemeToggle'
import { NAV_ITEMS, NAV_ICONS } from './navigation'

export default function MobileDrawer() {
  const { mobileDrawerOpen, setMobileDrawerOpen } = useAppContext()
  const location = useLocation()

  // Close on route change
  useEffect(() => {
    setMobileDrawerOpen(false)
  }, [location.pathname, setMobileDrawerOpen])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileDrawerOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [setMobileDrawerOpen])

  // Prevent scroll when open
  useEffect(() => {
    document.body.style.overflow = mobileDrawerOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileDrawerOpen])

  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 lg:hidden"
        style={{
          backgroundColor: 'rgba(4,17,10,0.48)',
          opacity: mobileDrawerOpen ? 1 : 0,
          pointerEvents: mobileDrawerOpen ? 'auto' : 'none',
          transition: 'opacity 520ms var(--motion)',
          backdropFilter: 'blur(18px)',
        }}
        onClick={() => setMobileDrawerOpen(false)}
      />

      {/* Drawer */}
      <div
        className="fixed left-0 top-0 bottom-0 z-50 flex flex-col lg:hidden"
        style={{
          width: '280px',
          background: 'var(--sidebar)',
          boxShadow: 'var(--shadow-elevated)',
          transform: mobileDrawerOpen ? 'translateX(0)' : 'translateX(-100%)',
          // 关闭后必须真正隐藏：只靠 translateX 会把抽屉留在焦点顺序和无障碍树里。
          // visibility 延迟到滑出动画结束再切换，保留原有过渡观感。
          visibility: mobileDrawerOpen ? 'visible' : 'hidden',
          transition: `transform 720ms var(--motion), visibility 0s linear ${mobileDrawerOpen ? '0s' : '720ms'}`,
          overscrollBehavior: 'contain',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4"
          style={{ minHeight: '56px' }}
        >
          <div className="flex items-center gap-2">
            <Icon
              icon="ph:wave-sine-light"
              className="w-5 h-5"
              style={{ color: 'var(--primary)' }}
            />
            <span
              className="font-semibold text-[0.9375rem]"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--sidebar-foreground)' }}
            >
              MioBridge
            </span>
          </div>
          <button
            onClick={() => setMobileDrawerOpen(false)}
            className="p-2 rounded-lg transition-[transform,background-color] duration-700 ease-[var(--motion)]"
            style={{ color: 'var(--muted-foreground)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--sidebar-accent)')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            aria-label="关闭菜单"
          >
            <Icon icon="ph:x-light" className="w-4 h-4" />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-3 space-y-0.5">
          {NAV_ITEMS.map(item => {
            const isActive = location.pathname === item.href
            return (
              <Link
                key={item.href}
                to={item.href}
                className="relative mx-2 flex items-center gap-3 rounded-full px-3 py-2.5 transition-[transform,background-color,color] duration-700 ease-[var(--motion)]"
                style={{
                  backgroundColor: isActive ? 'var(--sidebar-accent)' : 'transparent',
                  color: isActive ? 'var(--sidebar-accent-foreground)' : 'var(--sidebar-foreground)',
                }}
              >
                {isActive && (
                  <span
                    className="absolute left-0 rounded-r-full"
                    style={{ top: '50%', transform: 'translateY(-50%)', width: '3px', height: '60%', background: 'var(--primary)' }}
                  />
                )}
                <Icon icon={NAV_ICONS[item.icon]} className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm font-medium">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Bottom */}
        <div className="p-4 flex items-center gap-3">
          <ThemeToggle />
          <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>切换主题</span>
        </div>
      </div>
    </>,
    document.body
  )
}
