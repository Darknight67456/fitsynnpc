import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

const base = 'w-full rounded-lg border border-ink/20 bg-surface p-2 text-sm focus:border-brand focus:outline-none'

export function Input({ label, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  return (
    <label className='block text-sm'>
      {label && <span className='mb-1 block font-medium'>{label}</span>}
      <input className={`${base} ${className}`} {...props} />
    </label>
  )
}

export function Select({ label, className = '', children, ...props }:
  SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; children: ReactNode }) {
  return (
    <label className='block text-sm'>
      {label && <span className='mb-1 block font-medium'>{label}</span>}
      <select className={`${base} ${className}`} {...props}>{children}</select>
    </label>
  )
}
