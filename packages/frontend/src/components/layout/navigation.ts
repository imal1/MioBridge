export type NavIcon = 'overview' | 'subscription' | 'outputs' | 'nodes' | 'deploy' | 'agents' | 'runtimes' | 'status' | 'logs' | 'config' | 'api'

export const NAV_ITEMS: Array<{ href: string; icon: NavIcon; label: string }> = [
  { href: '/', icon: 'overview', label: '总览' },
  { href: '/nodes', icon: 'nodes', label: '节点' },
  { href: '/deploy', icon: 'deploy', label: '部署中心' },
  { href: '/agents', icon: 'agents', label: 'Agent 维护' },
  { href: '/runtimes', icon: 'runtimes', label: '运行时' },
  { href: '/subscription', icon: 'subscription', label: '订阅' },
  { href: '/outputs', icon: 'outputs', label: '衍生输出' },
  { href: '/subscription-status', icon: 'status', label: '订阅状态' },
  { href: '/logs', icon: 'logs', label: '日志' },
  { href: '/config', icon: 'config', label: '配置' },
  { href: '/api-docs', icon: 'api', label: 'API' },
]

export const PAGE_TITLES: Record<string, string> = {
  '/': '总览',
  '/subscription': '订阅',
  '/nodes': '节点',
  '/deploy': '部署',
  '/agents': 'Agent 维护',
  '/runtimes': '运行时',
  '/outputs': '衍生输出',
  '/subscription-status': '订阅状态',
  '/logs': '日志',
  '/config': '配置',
  '/actions': '操作',
  '/api-docs': 'API',
}
