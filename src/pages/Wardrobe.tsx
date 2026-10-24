import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useWardrobe } from '../modules/wardrobe/useWardrobe'
import { colorFamily } from '../modules/wardrobe/colorFamily'
import UploadForm from '../modules/wardrobe/UploadForm'
import EditModal from '../modules/wardrobe/EditModal'
import type { ClothingItem } from '../types'

export default function Wardrobe() {
  const { items, loading, error, reload } = useWardrobe()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ClothingItem | null>(null)
  const [cat, setCat] = useState('all')
  const [season, setSeason] = useState('all')
  const [family, setFamily] = useState('all')

  const shown = items.filter(i =>
    (cat === 'all' || i.category === cat) &&
    (season === 'all' || i.season === season) &&
    (family === 'all' || colorFamily(i.color) === family))

  async function remove(item: ClothingItem) {
    if (!confirm(`Delete ${item.name}?`)) return
    const path = item.image_url?.split('/wardrobe-images/')[1]
    if (path) await supabase.storage.from('wardrobe-images').remove([path])
    await supabase.from('clothing_items').delete().eq('id', item.id)
    void reload()
  }

  const sel = 'rounded border p-2'
  return (
    <div className='mx-auto max-w-5xl space-y-4 p-4'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-bold'>My Wardrobe ({shown.length})</h1>
        <div className='flex gap-2'>
          <button className='rounded bg-black px-3 py-2 text-white' onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Close' : 'Add item'}
          </button>
          <button className='rounded border px-3 py-2' onClick={() => supabase.auth.signOut()}>Log out</button>
        </div>
      </div>

      {showForm && <UploadForm onSaved={() => { setShowForm(false); void reload() }} />}

      <div className='flex flex-wrap gap-2'>
        <select className={sel} value={cat} onChange={e => setCat(e.target.value)}>
          {['all', 'top', 'bottom', 'outerwear', 'shoes', 'accessory'].map(c => <option key={c}>{c}</option>)}
        </select>
        <select className={sel} value={season} onChange={e => setSeason(e.target.value)}>
          {['all', 'hot', 'cool'].map(c => <option key={c}>{c}</option>)}
        </select>
        <select className={sel} value={family} onChange={e => setFamily(e.target.value)}>
          {['all', 'neutral', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'].map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      {loading && <p>Loading...</p>}
      {error && <p className='text-red-600'>{error}</p>}
      {!loading && shown.length === 0 && <p className='text-gray-500'>No items yet. Add your first one.</p>}

      <div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
        {shown.map(item => (
          <div key={item.id} className='overflow-hidden rounded border'>
            {item.image_url && <img src={item.image_url} alt={item.name} className='aspect-[4/5] w-full object-cover' />}
            <div className='space-y-1 p-2 text-sm'>
              <p className='font-semibold'>{item.name}</p>
              <p className='text-gray-500'>{item.category} · formality {item.formality}</p>
              <div className='flex gap-2'>
                <button className='underline' onClick={() => setEditing(item)}>Edit</button>
                <button className='text-red-600 underline' onClick={() => remove(item)}>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <EditModal item={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload() }} />
      )}
    </div>
  )
}
