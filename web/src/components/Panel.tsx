import type { ReactNode } from 'react'

export function Panel({ title, right, children, className }: { title?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel p-4 min-w-0 ${className ?? ''}`}>
      {(title || right) && (
        <header className="flex items-center justify-between mb-3 gap-3">
          {title && <h2 className="eyebrow">{title}</h2>}
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

export function Estimate({ children }: { children: ReactNode }) {
  return <span className="chip" title="Derived here from route geometry and event timestamps, not reported by the car">{children}</span>
}
