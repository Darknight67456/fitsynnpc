import { useState } from 'react'

// A password box with a Show/Hide button.
export default function PasswordInput({ label, value, onChange, autoComplete, placeholder }: {
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete: 'current-password' | 'new-password'
  placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <label className='block text-sm'>
      <span className='mb-1 block font-medium'>{label}</span>
      <span className='relative block'>
        <input type={show ? 'text' : 'password'} required value={value} autoComplete={autoComplete} placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className='w-full rounded-lg border border-ink/20 bg-surface p-2 pr-16 text-sm focus:border-brand focus:outline-none' />
        <button type='button' onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}
          className='absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-brand'>
          {show ? 'Hide' : 'Show'}
        </button>
      </span>
    </label>
  )
}
