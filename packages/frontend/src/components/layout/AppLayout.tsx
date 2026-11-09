import { AgentVersions } from '../AgentVersions'
import { Link } from 'react-router-dom'
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
        <AgentVersions />
        {children}
        <footer className="py-6 text-sm"><Link to="/help">帮助与首次使用引导</Link> <button className="ml-4" onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.reload(); }}>退出登录</button></footer>
      </main>
    </div>
  )
})

export default AppLayout
