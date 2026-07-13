import { Icon } from '@iconify/react'

interface SectionHeadingProps {
  icon: string
  title: string
  desc?: string
}

export default function SectionHeading({ icon, title, desc }: SectionHeadingProps) {
  return (
    <div className="section-rule">
      <div className="flex items-center gap-2.5">
        <Icon icon={icon} className="w-[18px] h-[18px]" style={{ color: 'var(--fern)' }} />
        <h2 className="text-base font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--foreground)' }}>
          {title}
        </h2>
      </div>
      {desc && <p className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>{desc}</p>}
    </div>
  )
}
