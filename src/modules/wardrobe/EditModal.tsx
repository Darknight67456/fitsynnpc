import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import Button from '../../components/Button'
import Modal from '../../components/Modal'
import TagFields from './TagFields'
import type { Tags } from './options'
import type { ClothingItem } from '../../types'

export default function EditModal({ item, onClose, onSaved }: {
  item: ClothingItem; onClose: () => void; onSaved: () => void
}) {
  const [tags, setTags] = useState<Tags>({
    name: item.name, category: item.category, color: item.color, pattern: item.pattern,
    fabric: item.fabric ?? '', season: item.season, formality: item.formality,
    formality_levels: item.formality_levels?.length ? item.formality_levels : [item.formality],
    subtype: item.subtype ?? '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!tags.name.trim()) { setError('Please give the item a name.'); return }
    if (tags.category === 'accessory' && !tags.subtype) { setError('Choose the type of accessory (bag, watch...).'); return }
    setBusy(true)
    const { error } = await supabase.from('clothing_items').update(tags).eq('id', item.id)
    setBusy(false)
    if (error) setError(error.message)
    else onSaved()
  }

  return (
    <Modal open title='Edit item' onClose={onClose}>
      <div className='max-h-[70vh] space-y-4 overflow-y-auto pr-1'>
        {item.image_url && <img src={item.image_url} alt={item.name} className='h-32 rounded' />}
        <TagFields value={tags} onChange={setTags} />
        {error && <p className='text-sm text-red-600'>{error}</p>}
      </div>
      <div className='mt-4 flex justify-end gap-2'>
        <Button variant='secondary' onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button>
      </div>
    </Modal>
  )
}
