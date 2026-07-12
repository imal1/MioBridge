import StatusBadge from '@/components/shared/StatusBadge'
import { KERNEL_TYPES, type KernelRuntimeStatus, type KernelType, type NodeKernelConfig } from '@/lib/types'

export const kernelLabels: Record<KernelType, string> = {
  'sing-box': 'Sing-Box',
  xray: 'Xray',
  v2ray: 'V2Ray',
}

export type KernelDisplayStatus = 'unknown' | 'unmonitored' | 'installation-failed' | 'inaccessible' | 'normal'

interface NormalizedKernelRuntimeStatus extends KernelRuntimeStatus {
  reported: boolean
}

const statusPresentation: Record<KernelDisplayStatus, {
  label: string
  variant: 'success' | 'warning' | 'danger' | 'info'
}> = {
  unknown: { label: '未知', variant: 'info' },
  unmonitored: { label: '未监听', variant: 'info' },
  'installation-failed': { label: '安装失败', variant: 'danger' },
  inaccessible: { label: '配置不可访问', variant: 'warning' },
  normal: { label: '正常', variant: 'success' },
}

export function normalizeKernelRuntimeStatuses(
  kernels: readonly KernelRuntimeStatus[] | undefined,
  configuredKernels: readonly NodeKernelConfig[] = [],
): NormalizedKernelRuntimeStatus[] {
  const runtimeByType = new Map<KernelType, KernelRuntimeStatus>()
  for (const kernel of kernels || []) {
    if (KERNEL_TYPES.includes(kernel.type) && !runtimeByType.has(kernel.type)) {
      runtimeByType.set(kernel.type, kernel)
    }
  }
  const configuredByType = new Map(configuredKernels.map(kernel => [kernel.type, kernel]))
  return KERNEL_TYPES.map(type => {
    const runtime = runtimeByType.get(type)
    if (runtime) return { ...runtime, reported: true }
    const configured = configuredByType.get(type)
    return {
      type,
      detected: false,
      monitored: configured !== undefined,
      accessible: false,
      nodesCount: 0,
      configPaths: configured?.configPath ? [configured.configPath] : [],
      reported: false,
    }
  })
}

export function getKernelDisplayStatus(
  online: boolean,
  kernel: KernelRuntimeStatus,
  reported = true,
): KernelDisplayStatus {
  if (!online || !reported) return 'unknown'
  if (!kernel.monitored) return 'unmonitored'
  if (kernel.error && !kernel.detected) return 'installation-failed'
  if (!kernel.accessible) return 'inaccessible'
  return 'normal'
}

export function KernelStatusBadge({
  online,
  kernel,
  reported = true,
}: {
  online: boolean
  kernel: KernelRuntimeStatus
  reported?: boolean
}) {
  const presentation = statusPresentation[getKernelDisplayStatus(online, kernel, reported)]
  return <StatusBadge label={presentation.label} status={presentation.variant} />
}

function KernelStatusPill({ online, kernel }: { online: boolean; kernel: NormalizedKernelRuntimeStatus }) {
  return (
    <span className="flex items-center gap-2 rounded-full bg-[var(--surface-container)] px-2 py-1">
      <span data-testid="kernel-status-type" className="text-[10px] font-semibold" style={{ color: 'var(--foreground)' }}>
        {kernelLabels[kernel.type]}
      </span>
      <KernelStatusBadge online={online} kernel={kernel} reported={kernel.reported} />
    </span>
  )
}

export function KernelStatusPills({
  online,
  kernels,
  configuredKernels,
}: {
  online: boolean
  kernels: readonly KernelRuntimeStatus[]
  configuredKernels?: readonly NodeKernelConfig[]
}) {
  const normalized = normalizeKernelRuntimeStatuses(kernels, configuredKernels)
  return normalized.map(kernel => (
    <KernelStatusPill key={kernel.type} online={online} kernel={kernel} />
  ))
}

export function KernelRuntimeDetails({
  online,
  kernels,
  configuredKernels,
}: {
  online: boolean
  kernels: readonly KernelRuntimeStatus[]
  configuredKernels?: readonly NodeKernelConfig[]
}) {
  const normalized = normalizeKernelRuntimeStatuses(kernels, configuredKernels)
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {normalized.map(kernel => (
        <section
          key={kernel.type}
          className="rounded-2xl bg-[var(--surface-container)] p-3"
          aria-label={`${kernelLabels[kernel.type]} 内核详情`}
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
              {kernelLabels[kernel.type]}
            </h4>
            <KernelStatusBadge online={online} kernel={kernel} reported={kernel.reported} />
          </div>
          <dl className="mt-3 grid gap-2 text-xs">
            <div className="flex justify-between gap-3">
              <dt style={{ color: 'var(--muted-foreground)' }}>版本</dt>
              <dd className="font-mono text-right" style={{ color: 'var(--foreground)' }}>{kernel.version || '-'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt style={{ color: 'var(--muted-foreground)' }}>配置路径</dt>
              <dd className="min-w-0 break-all text-right font-mono" style={{ color: 'var(--foreground)' }}>
                {kernel.configPaths.length > 0 ? kernel.configPaths.join('、') : '-'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt style={{ color: 'var(--muted-foreground)' }}>代理数</dt>
              <dd style={{ color: 'var(--foreground)' }}>{kernel.nodesCount} 个代理</dd>
            </div>
            {kernel.error ? (
              <div className="flex justify-between gap-3">
                <dt style={{ color: 'var(--muted-foreground)' }}>错误</dt>
                <dd className="min-w-0 break-words text-right" style={{ color: 'var(--destructive)' }}>{kernel.error}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ))}
    </div>
  )
}
