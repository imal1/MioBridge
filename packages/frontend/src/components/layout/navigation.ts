export type NavIcon = 'overview' | 'subscription' | 'nodes' | 'logs' | 'config' | 'api'

export interface NavItem { href: string; icon: NavIcon; label: string; badge?: string }

// 重设计导航：主区三项 + 系统区三项。部署/Agent/运行时并入「节点」详情标签页，
// 衍生输出并入「总览」，订阅状态并入「订阅」。旧路由在 App.tsx 里 302 到新锚点。
export const NAV_MAIN: NavItem[] = [
  { href: '/', icon: 'overview', label: '总览' },
  { href: '/nodes', icon: 'nodes', label: '节点' },
  { href: '/subscription', icon: 'subscription', label: '订阅' },
]

export const NAV_SYSTEM: NavItem[] = [
  { href: '/logs', icon: 'logs', label: '日志' },
  { href: '/config', icon: 'config', label: '配置' },
  { href: '/api-docs', icon: 'api', label: 'API' },
]

export const NAV_ITEMS: NavItem[] = [...NAV_MAIN, ...NAV_SYSTEM]

export const NAV_ICONS: Record<NavIcon, string> = {
  overview: 'ph:gauge-light',
  nodes: 'ph:hard-drives-light',
  subscription: 'ph:arrows-clockwise-light',
  logs: 'ph:terminal-window-light',
  config: 'ph:sliders-horizontal-light',
  api: 'ph:globe-hemisphere-west-light',
}

export const PAGE_TITLES: Record<string, string> = {
  '/': '总览',
  '/nodes': '节点',
  '/subscription': '订阅',
  '/logs': '日志',
  '/config': '配置',
  '/api-docs': 'API',
}
