import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useWardrobe } from '../modules/wardrobe/useWardrobe'
import { COLOR_NAMES, colorName } from '../modules/wardrobe/colorFamily'
import { applyFilters, filtersActive, NO_FILTERS, type Filters } from '../modules/wardrobe/wardrobeFilters'
import { ACCESSORY_TYPES, ALL_PATTERNS, CATEGORIES, SEASONS, labelOf, occasionText } from '../modules/wardrobe/options'
import UploadForm from '../modules/wardrobe/UploadForm'
import EditModal from '../modules/wardrobe/EditModal'
import WearModal from '../modules/wardrobe/WearModal'
import Button from '../components/Button'
import Card from '../components/Card'
import { Input, Select } from '../components/Field'
import type { ClothingItem } from '../types'

// "today", "yesterday" or "5 days ago" from a date saved as YYYY-MM-DD
function lastWornText(date: string | null): string {
  if (!date) return 'never worn'
  const days = Math.round((Date.now() - new Date(`${date.slice(0, 10)}T00:00:00`).getTime()) / 86_400_000)
  if (days <= 0) return 'last worn today'
  if (days === 1) return 'last worn yesterday'
  return `last worn ${days} days ago`
}

export default function Wardrobe() {
  const { items, loading, error, reload } = useWardrobe()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ClothingItem | null>(null)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [logging, setLogging] = useState<ClothingItem | null>(null)   // the item whose wear history is open
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters(f => ({ ...f, [k]: v }))

  const shown = useMemo(() => applyFilters(items, filters), [items, filters])
  const count = (cat: string) => items.filter(i => i.category === cat).length

  async function remove(item: ClothingItem) {
    if (!confirm(`Delete ${item.name}?`)) return
    const path = item.image_url?.split('/wardrobe-images/')[1]
    if (path) await supabase.storage.from('wardrobe-images').remove([path])
    await supabase.from('clothing_items').delete().eq('id', item.id)
    void reload()
  }

  return (
    <div className='mx-auto max-w-5xl space-y-4 p-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div>
          <h1 className='text-2xl font-bold'>My Wardrobe</h1>
          <p className='text-sm text-muted'>
            {items.length} items · {CATEGORIES.map(c => `${count(c.value)} ${c.label.toLowerCase()}`).join(' · ')}
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Close' : 'Add item'}</Button>
      </div>

      {showForm && <UploadForm items={items} onSaved={() => { setShowForm(false); void reload() }} />}

      <Card className='space-y-3'>
        <Input placeholder='Search by name, fabric or tag...' value={filters.search}
          onChange={e => set('search', e.target.value)} />
        <div className='grid grid-cols-2 gap-2 md:grid-cols-5'>
          <Select value={filters.category} onChange={e => set('category', e.target.value)} aria-label='Category'>
            <option value='all'>All categories</option>
            {CATEGORIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select value={filters.season} onChange={e => set('season', e.target.value)} aria-label='Season'>
            <option value='all'>Any season</option>
            {SEASONS.filter(o => o.value !== 'all').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select value={filters.color} onChange={e => set('color', e.target.value)} aria-label='Color'>
            <option value='all'>Any color</option>
            {COLOR_NAMES.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={filters.pattern} onChange={e => set('pattern', e.target.value)} aria-label='Pattern'>
            <option value='all'>Any pattern</option>
            {ALL_PATTERNS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select value={filters.sort} onChange={e => set('sort', e.target.value as Filters['sort'])} aria-label='Sort'>
            <option value='newest'>Newest first</option>
            <option value='most-worn'>Most worn</option>
            <option value='least-worn'>Least worn</option>
            <option value='name'>Name A to Z</option>
          </Select>
        </div>
        <div className='flex items-center justify-between text-sm text-muted'>
          <span>Showing {shown.length} of {items.length}</span>
          {filtersActive(filters) && (
            <button className='underline' onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>
          )}
        </div>
      </Card>

      {loading && <p>Loading...</p>}
      {error && <p className='text-red-600'>{error}</p>}
      {!loading && items.length === 0 && (
        <Card className='text-center text-muted'>Your wardrobe is empty. Press "Add item" and upload your first piece.</Card>
      )}
      {!loading && items.length > 0 && shown.length === 0 && (
        <Card className='text-center text-muted'>Nothing matches these filters.</Card>
      )}

      <div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
        {shown.map(item => (
          <Card key={item.id} className='overflow-hidden !p-0'>
            {item.image_url && <img src={item.image_url} alt={item.name} className='aspect-[4/5] w-full object-cover' />}
            <div className='space-y-2 p-3 text-sm'>
              <p className='font-semibold'>{item.name}</p>
              <div className='flex flex-wrap gap-1 text-xs'>
                <span className='inline-flex items-center gap-1 rounded-full bg-ink/5 px-2 py-0.5'>
                  <span className='h-3 w-3 rounded-full border border-ink/20' style={{ background: item.color }} />
                  {colorName(item.color)}
                </span>
                <span className='rounded-full bg-ink/5 px-2 py-0.5'>{item.category === 'accessory' && item.subtype ? labelOf(ACCESSORY_TYPES, item.subtype) : labelOf(CATEGORIES, item.category)}</span>
                <span className='rounded-full bg-ink/5 px-2 py-0.5'>{labelOf(SEASONS, item.season)}</span>
                <span className='rounded-full bg-ink/5 px-2 py-0.5'>{occasionText(item.formality_levels, item.formality)}</span>
              </div>
              <p className='text-xs text-muted'>
                {item.pattern}{item.fabric ? ` · ${item.fabric}` : ''} · worn {item.wear_count}x · {lastWornText(item.last_worn_at)}
              </p>
              <Button variant='secondary' className='w-full !py-1' onClick={() => setLogging(item)}>Log when worn</Button>
              <div className='flex gap-3'>
                <button className='underline' onClick={() => setEditing(item)}>Edit</button>
                <button className='text-red-600 underline' onClick={() => void remove(item)}>Delete</button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {logging && (
        <WearModal key={logging.id} item={logging} onClose={() => setLogging(null)} onChanged={reload} />
      )}

      {editing && (
        <EditModal key={editing.id} item={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload() }} />
      )}
    </div>
  )
}
