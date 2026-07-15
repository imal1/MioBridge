export interface WorkflowStep {
  id: string
  label: string
  description: string
  href: string
}

export const WORKFLOW_STEPS: WorkflowStep[] = [
  { id: 'add-node', label: '添加节点', description: '登记主机与 SSH 凭据', href: '/nodes?intent=add' },
  { id: 'manage-node', label: '管理节点', description: '查看节点档案与状态', href: '/nodes' },
  { id: 'deploy-agent', label: '部署监控程序', description: '安装或重新部署 Agent', href: '/deploy?component=agent' },
  { id: 'maintain-agent', label: '维护监控程序', description: '启动、停止、重启与健康检查', href: '/agents' },
  { id: 'deploy-kernel', label: '部署运行时', description: '部署 mihomo 与协议核心', href: '/deploy?component=sing-box' },
  { id: 'manage-kernel', label: '管理运行时', description: '维护核心与监控范围', href: '/runtimes' },
  { id: 'generate-subscription', label: '生成订阅', description: '聚合来源并运行生成管线', href: '/subscription?mode=generate' },
  { id: 'derive-output', label: '生成衍生输出', description: '访问、下载或手动转换', href: '/outputs' },
  { id: 'maintain-subscription', label: '维护订阅状态', description: '检查产物状态与告警', href: '/subscription-status' },
  { id: 'logs', label: '日志', description: '定位节点运行问题', href: '/logs' },
  { id: 'api', label: 'API', description: '查阅集成端点', href: '/api-docs' },
]

export function workflowHref(id: string, nodeId?: string): string {
  const step = WORKFLOW_STEPS.find(item => item.id === id)
  if (!step || !nodeId) return step?.href ?? '/'
  const separator = step.href.includes('?') ? '&' : '?'
  return `${step.href}${separator}node=${encodeURIComponent(nodeId)}`
}
