import type { HTMLAttributes } from 'react'

export default function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-xl border border-ink/10 bg-surface p-4 shadow-sm ${className}`} {...props} />
  )
}
