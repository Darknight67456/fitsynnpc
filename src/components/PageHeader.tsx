import type { ReactNode } from 'react'

export default function PageHeader({ title, subtitle, children }: {
  title: string
  subtitle?: string
  children?: ReactNode
}) {
  return (
    <div className='mb-4 flex flex-wrap items-end justify-between gap-2'>
      <div>
        <h1 className='text-2xl font-bold'>{title}</h1>
        {subtitle && <p className='text-sm text-muted'>{subtitle}</p>}
      </div>
      {children && <div className='flex gap-2'>{children}</div>}
    </div>
  )
}
