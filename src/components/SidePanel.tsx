import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Dialog that slides in from the right on desktop and fills the screen on mobile.
 * Escape and the backdrop close it; focus moves inside on open and returns to the opener on close.
 */
export default function SidePanel({
  open,
  title,
  onClose,
  children,
  footer,
  width = 'md:w-[440px]',
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close]), [tabindex="0"]')
    ;(first ?? panel)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key !== 'Tab' || !panel) return
      // Keep Tab inside the panel.
      const focusable = [...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex="0"]')]
      if (focusable.length === 0) return
      const firstEl = focusable[0]
      const lastEl = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className='fixed inset-0 z-40 flex justify-end bg-black/40' onClick={onClose}>
      <div
        ref={panelRef}
        role='dialog'
        aria-modal='true'
        aria-label={title}
        tabIndex={-1}
        className={`flex h-full w-full flex-col bg-surface shadow-xl ${width}`}
        onClick={e => e.stopPropagation()}
      >
        <div className='flex items-center justify-between border-b border-ink/10 px-4 py-3'>
          <h2 className='text-lg font-bold'>{title}</h2>
          <button
            type='button'
            data-close
            onClick={onClose}
            className='rounded-lg px-2 py-1 text-sm font-medium text-muted hover:bg-ink/5 hover:text-ink'
          >
            Close
          </button>
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto p-4'>{children}</div>
        {footer && <div className='border-t border-ink/10 px-4 py-3'>{footer}</div>}
      </div>
    </div>
  )
}
