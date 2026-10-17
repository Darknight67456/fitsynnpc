import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { Category } from '../../types'

const CATEGORIES: Category[] = ['top', 'bottom', 'outerwear', 'shoes', 'accessory']

export default function UploadForm({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('top')
  const [color, setColor] = useState('#000000')
  const [pattern, setPattern] = useState('plain')
  const [fabric, setFabric] = useState('')
  const [season, setSeason] = useState('all')
  const [formality, setFormality] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    if (!file) { setError('Please choose a photo.'); return }
    setBusy(true)
    setError('')

    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`
    const up = await supabase.storage.from('wardrobe-images').upload(path, file)
    if (up.error) { setError(up.error.message); setBusy(false); return }
    const { data } = supabase.storage.from('wardrobe-images').getPublicUrl(path)

    const ins = await supabase.from('clothing_items').insert({
      name, category, color, pattern, fabric, season, formality, image_url: data.publicUrl,
    })
    setBusy(false)
    if (ins.error) { setError(ins.error.message); return }

    setFile(null)
    setName('')
    onSaved()
  }

  const input = 'w-full rounded border p-2'
  return (
    <form onSubmit={save} className='space-y-2 rounded border p-4'>
      <input type='file' accept='image/*' onChange={e => setFile(e.target.files?.[0] ?? null)} />
      {file && <img src={URL.createObjectURL(file)} alt='preview' className='h-32 rounded' />}
      <input className={input} required placeholder='Name (e.g. Navy blazer)' value={name}
        onChange={e => setName(e.target.value)} />
      <select className={input} value={category} onChange={e => setCategory(e.target.value as Category)}>
        {CATEGORIES.map(c => <option key={c}>{c}</option>)}
      </select>
      <label className='flex items-center gap-2'>Color
        <input type='color' value={color} onChange={e => setColor(e.target.value)} />
      </label>
      <input className={input} placeholder='Pattern (plain, striped, floral...)' value={pattern}
        onChange={e => setPattern(e.target.value)} />
      <input className={input} placeholder='Fabric (cotton, denim...)' value={fabric}
        onChange={e => setFabric(e.target.value)} />
      <select className={input} value={season} onChange={e => setSeason(e.target.value)}>
        <option>all</option><option>hot</option><option>cool</option>
      </select>
      <label className='block'>Formality: {formality} (1 casual, 5 formal)
        <input type='range' min={1} max={5} value={formality} className='w-full'
          onChange={e => setFormality(Number(e.target.value))} />
      </label>
      {error && <p className='text-sm text-red-600'>{error}</p>}
      <button className='rounded bg-black px-4 py-2 text-white disabled:opacity-50' disabled={busy}>
        {busy ? 'Saving...' : 'Add to wardrobe'}
      </button>
    </form>
  )
}
