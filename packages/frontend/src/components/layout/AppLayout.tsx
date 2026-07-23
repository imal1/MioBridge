import { memo } from 'react'
import Sidebar from './Sidebar'
import MobileDrawer from './MobileDrawer'
import MobileHeader from './MobileHeader'

interface AppLayoutProps {
  children: React.ReactNode
}

const AppLayout = memo(function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="mb-app">
      {/* Desktop fixed rail */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile header + drawer */}
      <div className="lg:hidden">
        <MobileHeader />
      </div>
      <MobileDrawer />

      <main id="main-content" className="mb-main">
        {children}
      </main>
    </div>
  )
})

export default AppLayout
