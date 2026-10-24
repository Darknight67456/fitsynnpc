import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { ClothingItem } from '../../types'

export default function EditModal({ item, onClose, onSaved }: {
  item: ClothingItem; onClose: () => void; onSaved: () => void
}) {
  const [f, setF] = useState({
    name: item.name, category: item.category, color: item.color, pattern: item.pattern,
    fabric: item.fabric ?? '', season: item.season, formality: item.formality,
  })
  const [error, setError] = useState('')
  const set = (k: string, v: string | number) => setF(prev => ({ ...prev, [k]: v }))

  async function save() {
    const { error } = await supabase.from('clothing_items').update(f).eq('id', item.id)
    if (error) setError(error.message)
    else onSaved()
  }

  const input = 'w-full rounded border p-2'
  return (
    <div className='fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4'>
      <div className='w-full max-w-sm space-y-2 rounded bg-white p-4'>
        <h2 className='font-bold'>Edit item</h2>
        <input className={input} value={f.name} onChange={e => set('name', e.target.value)} />
        <select className={input} value={f.category} onChange={e => set('category', e.target.value)}>
          {['top', 'bottom', 'outerwear', 'shoes', 'accessory'].map(c => <option key={c}>{c}</option>)}
        </select>
        <input type='color' value={f.color} onChange={e => set('color', e.target.value)} />
        <input className={input} value={f.pattern} onChange={e => set('pattern', e.target.value)} />
        <input className={input} value={f.fabric} onChange={e => set('fabric', e.target.value)} />
        <select className={input} value={f.season} onChange={e => set('season', e.target.value)}>
          <option>all</option><option>hot</option><option>cool</option>
        </select>
        <label className='block'>Formality: {f.formality}
          <input type='range' min={1} max={5} value={f.formality} className='w-full'
            onChange={e => set('formality', Number(e.target.value))} />
        </label>
        {error && <p className='text-sm text-red-600'>{error}</p>}
        <div className='flex justify-end gap-2'>
          <button className='rounded border px-3 py-2' onClick={onClose}>Cancel</button>
          <button className='rounded bg-black px-3 py-2 text-white' onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
