import { Icon } from '@iconify/react'
import { Link } from 'react-router-dom'
import { WORKFLOW_STEPS } from '@/lib/workflow'

export default function WorkflowRail({ current }: { current: string }) {
  return (
    <nav aria-label="用户需求闭环" className="mb-5 overflow-x-auto rounded-[24px] border border-[var(--border)] bg-[var(--surface-container-lowest)] p-3">
      <ol className="flex min-w-max items-center gap-2">
        {WORKFLOW_STEPS.map((step, index) => {
          const active = step.id === current
          return (
            <li key={step.id} className="flex items-center gap-2">
              {index > 0 ? <Icon icon="ph:caret-right-light" className="h-4 w-4 text-muted-foreground" /> : null}
              <Link
                to={step.href}
                aria-current={active ? 'step' : undefined}
                className="rounded-2xl border px-3 py-2 transition-colors"
                style={{
                  borderColor: active ? 'var(--primary)' : 'var(--border)',
                  background: active ? 'var(--primary-container)' : 'var(--surface-container)',
                  color: active ? 'var(--on-primary-container)' : 'var(--foreground)',
                }}
              >
                <span className="block text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                <span className="block text-sm font-medium">{step.label}</span>
              </Link>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
