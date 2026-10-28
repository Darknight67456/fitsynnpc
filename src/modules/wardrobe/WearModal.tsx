import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Button from '../../components/Button'
import Modal from '../../components/Modal'
import type { ClothingItem } from '../../types'

interface Entry { id: string; worn_on: string }

const todayText = () => new Date().toLocaleDateString('en-CA')   // YYYY-MM-DD in the user's own time zone
const pretty = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

export default function WearModal({ item, onClose, onChanged }: {
  item: ClothingItem; onClose: () => void; onChanged: () => void
}) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const [date, setDate] = useState(todayText())
  const [editId, setEditId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase.from('wear_log').select('id, worn_on').eq('item_id', item.id)
      .order('worn_on', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error.message)
        else setEntries(data as Entry[])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [item.id, tick])

  // After every change, recount from the log so the card always matches the history.
  const sync = useCallback(async () => {
    const { data, error } = await supabase.from('wear_log').select('worn_on').eq('item_id', item.id)
      .order('worn_on', { ascending: false })
    if (error) { setError(error.message); return }
    const { error: e2 } = await supabase.from('clothing_items')
      .update({ wear_count: data.length, last_worn_at: data[0]?.worn_on ?? null }).eq('id', item.id)
    if (e2) { setError(e2.message); return }
    setTick(t => t + 1)
    onChanged()
  }, [item.id, onChanged])

  async function add() {
    setError('')
    if (!date) { setError('Pick a date.'); return }
    if (date > todayText()) { setError('You cannot log a day in the future.'); return }
    if (entries.some(e => e.worn_on === date)) { setError('You already logged this day.'); return }
    const { error } = await supabase.from('wear_log').insert({ item_id: item.id, worn_on: date })
    if (error) { setError(error.message); return }
    await sync()
  }

  async function saveEdit() {
    if (!editId) return
    setError('')
    if (!editDate || editDate > todayText()) { setError('Pick a date that is today or earlier.'); return }
    if (entries.some(e => e.worn_on === editDate && e.id !== editId)) { setError('You already logged this day.'); return }
    const { error } = await supabase.from('wear_log').update({ worn_on: editDate }).eq('id', editId)
    if (error) { setError(error.message); return }
    setEditId(null)
    await sync()
  }

  async function remove(id: string) {
    setError('')
    const { error } = await supabase.from('wear_log').delete().eq('id', id)
    if (error) { setError(error.message); return }
    await sync()
  }

  return (
    <Modal open title={`When did you wear it? ${item.name}`} onClose={onClose}>
      <div className='space-y-4'>
        <div className='flex items-end gap-2'>
          <label className='block flex-1 text-sm'>
            <span className='mb-1 block font-medium'>Date worn</span>
            <input type='date' value={date} max={todayText()} onChange={e => setDate(e.target.value)}
              className='w-full rounded-lg border border-ink/20 bg-surface p-2 text-sm' />
          </label>
          <Button onClick={() => void add()}>Add</Button>
        </div>

        {error && <p className='text-sm text-red-600'>{error}</p>}

        <div>
          <p className='mb-1 text-sm font-medium'>History ({entries.length})</p>
          {loading && <p className='text-sm text-muted'>Loading...</p>}
          {!loading && entries.length === 0 && <p className='text-sm text-muted'>Not logged yet.</p>}
          <ul className='max-h-60 divide-y divide-ink/10 overflow-y-auto'>
            {entries.map(e => (
              <li key={e.id} className='flex items-center justify-between gap-2 py-2 text-sm'>
                {editId === e.id ? (
                  <>
                    <input type='date' value={editDate} max={todayText()} onChange={ev => setEditDate(ev.target.value)}
                      className='rounded-lg border border-ink/20 bg-surface p-1 text-sm' />
                    <span className='flex gap-3'>
                      <button className='font-medium underline' onClick={() => void saveEdit()}>Save</button>
                      <button className='underline' onClick={() => setEditId(null)}>Cancel</button>
                    </span>
                  </>
                ) : (
                  <>
                    <span>{pretty(e.worn_on)}</span>
                    <span className='flex gap-3'>
                      <button className='underline' onClick={() => { setEditId(e.id); setEditDate(e.worn_on) }}>Edit</button>
                      <button className='text-red-600 underline' onClick={() => void remove(e.id)}>Remove</button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className='flex justify-end'><Button variant='secondary' onClick={onClose}>Done</Button></div>
      </div>
    </Modal>
  )
}
