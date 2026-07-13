interface StatusBadgeProps {
  label: string
  status: 'success' | 'warning' | 'danger' | 'info'
}

export default function StatusBadge({ label, status }: StatusBadgeProps) {
  const cls = {
    success: 'stats-badge stats-badge-success',
    warning: 'stats-badge stats-badge-warning',
    danger:  'stats-badge stats-badge-danger',
    info:    'stats-badge stats-badge-info',
  }[status]

  const dotActive = status === 'success' || status === 'info'

  return (
    <span className={cls}>
      <span className={`live-dot ${dotActive ? 'live-dot-active' : 'live-dot-inactive'}`} />
      {label}
    </span>
  )
}
