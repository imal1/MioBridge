import { memo } from 'react'
import Sidebar from './Sidebar'
import MobileDrawer from './MobileDrawer'
import MobileHeader from './MobileHeader'
import { useAppContext } from '@/context/AppContext'

interface AppLayoutProps {
  children: React.ReactNode
}

const AppLayout = memo(function AppLayout({ children }: AppLayoutProps) {
  const { sidebarCollapsed } = useAppContext()

  return (
    <div className="min-h-[100dvh]">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile header */}
      <div className="lg:hidden">
        <MobileHeader />
      </div>

      {/* Mobile drawer (portal, always mounted) */}
      <MobileDrawer />

      {/* Main content — shifts right by sidebar width on desktop */}
      <DesktopContentOffset collapsed={sidebarCollapsed}>
        <main id="main-content">{children}</main>
      </DesktopContentOffset>
    </div>
  )
})

function DesktopContentOffset({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
  return (
    <div className={`desktop-offset ${collapsed ? 'desktop-offset-collapsed' : 'desktop-offset-expanded'}`}>
      {children}
    </div>
  )
}

export default AppLayout
