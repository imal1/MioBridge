export default function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{label}</span>
      <span className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--foreground)' }}>
        {children}
      </span>
    </div>
  )
}
