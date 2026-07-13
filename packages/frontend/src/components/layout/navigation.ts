export type NavIcon = 'overview' | 'subscription' | 'nodes' | 'deploy' | 'logs' | 'config' | 'api'

export const NAV_ITEMS: Array<{ href: string; icon: NavIcon; label: string }> = [
  { href: '/', icon: 'overview', label: '总览' },
  { href: '/subscription', icon: 'subscription', label: '订阅' },
  { href: '/nodes', icon: 'nodes', label: '节点' },
  { href: '/deploy', icon: 'deploy', label: '部署' },
  { href: '/logs', icon: 'logs', label: '日志' },
  { href: '/config', icon: 'config', label: '配置' },
  { href: '/api-docs', icon: 'api', label: 'API' },
]

export const PAGE_TITLES: Record<string, string> = {
  '/': '总览',
  '/subscription': '订阅',
  '/nodes': '节点',
  '/deploy': '部署',
  '/logs': '日志',
  '/config': '配置',
  '/actions': '操作',
  '/api-docs': 'API',
}
