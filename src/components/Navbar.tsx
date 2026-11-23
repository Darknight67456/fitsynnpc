import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Button from './Button'

const LINKS = [
  { to: '/', label: 'Wardrobe' },
  { to: '/catalog', label: 'Catalog' },
  { to: '/outfits', label: 'Outfits' },
  { to: '/stylist', label: 'Stylist' },
  { to: '/colors', label: 'Colors' },
  { to: '/visualizer', label: 'Try-on' },
  { to: '/size', label: 'Size' },
  { to: '/insights', label: 'Insights' },
]

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand text-white' : 'text-ink hover:bg-ink/5'}`

  return (
    <header className='sticky top-0 z-20 border-b border-ink/10 bg-surface'>
      <div className='relative mx-auto flex max-w-6xl items-center justify-between p-3'>
        <span className='text-lg font-bold text-brand'>FitSync</span>
        <button className='rounded-lg border border-ink/20 px-3 py-1 text-sm md:hidden'
          onClick={() => setOpen(!open)} aria-label='Menu'>
          {open ? 'Close' : 'Menu'}
        </button>
        <nav className={`${open ? 'flex' : 'hidden'} absolute left-0 top-full w-full flex-col gap-1 border-b border-ink/10 bg-surface p-3 md:static md:flex md:w-auto md:flex-row md:items-center md:border-0 md:p-0`}>
          {LINKS.map(l => (
            <NavLink key={l.to} to={l.to} end={l.to === '/'} className={link} onClick={() => setOpen(false)}>
              {l.label}
            </NavLink>
          ))}
          <Button variant='secondary' onClick={() => supabase.auth.signOut()}>Log out</Button>
        </nav>
      </div>
    </header>
  )
}
