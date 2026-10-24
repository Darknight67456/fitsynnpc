import type { ReactNode } from 'react'

export default function Modal({ open, title, onClose, children }: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className='fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4' onClick={onClose}>
      <div className='w-full max-w-md rounded-xl bg-surface p-5 shadow-lg' onClick={e => e.stopPropagation()}>
        <div className='mb-3 flex items-center justify-between'>
          <h2 className='text-lg font-bold'>{title}</h2>
          <button className='text-muted hover:text-ink' onClick={onClose} aria-label='Close'>x</button>
        </div>
        {children}
      </div>
    </div>
  )
}
