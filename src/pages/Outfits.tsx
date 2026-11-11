import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { embedImage, recommend, type RecommendResult } from '../lib/ai'
import { useWardrobe } from '../modules/wardrobe/useWardrobe'
import { logWornToday } from '../modules/wardrobe/wearLog'
import { ACCESSORY_TYPES, FORMALITY, SEASONS, labelOf } from '../modules/wardrobe/options'
import Button from '../components/Button'
import Card from '../components/Card'
import { Select } from '../components/Field'

const THEMES = [
  'Office day', 'Job interview', 'Wedding guest', 'Hari Raya visit', 'Date night',
  'Casual hangout', 'Gym session', 'Rainy day errands', 'Graduation', 'Family dinner',
]

export default function Outfits() {
  const { items, loading, error: loadError, reload } = useWardrobe()
  const navigate = useNavigate()
  const [event, setEvent] = useState('')
  const [weather, setWeather] = useState('')       // '' = let the AI decide
  const [formality, setFormality] = useState('')   // '' = let the AI decide
  const [outerwear, setOuterwear] = useState<'auto' | 'yes' | 'no'>('auto')
  const [accessories, setAccessories] = useState<string[]>([])   // accessory types the user wants
  const [result, setResult] = useState<RecommendResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [prep, setPrep] = useState('')
  const [error, setError] = useState('')
  const [worn, setWorn] = useState<number | null>(null)

  const ready = items.filter(i => Array.isArray(i.embedding) && i.embedding.length > 0)
  const missing = items.length - ready.length

  // Older items were saved before the AI existed. This gives them their fingerprint.
  async function prepareOld() {
    setError('')
    const todo = items.filter(i => !i.embedding && i.image_url)
    for (let n = 0; n < todo.length; n++) {
      setPrep(`Preparing ${n + 1} of ${todo.length}...`)
      try {
        const blob = await (await fetch(todo[n].image_url as string)).blob()
        const e = await embedImage(blob)
        const { error } = await supabase.from('clothing_items').update(e).eq('id', todo[n].id)
        if (error) throw new Error(error.message)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not prepare an item.')
        break
      }
    }
    setPrep('')
    reload()
  }

  async function suggest() {
    setError('')
    setResult(null)
    setWorn(null)
    if (!event.trim()) { setError('Describe the event first, or tap a theme.'); return }
    setBusy(true)
    try {
      setResult(await recommend({
        event,
        items: ready.map(i => ({
          id: i.id, name: i.name, category: i.category, season: i.season,
          formality: i.formality, formality_levels: i.formality_levels?.length ? i.formality_levels : [i.formality],
          subtype: i.subtype ?? '',
          wear_count: i.wear_count, embedding: i.embedding as number[],
        })),
        formality: formality ? Number(formality) : undefined,
        weather: weather || undefined,
        outerwear,
        accessories,
      }))
    } catch (e) {
      setError(e instanceof Error ? `${e.message} Is the AI service running?` : 'Something went wrong.')
    }
    setBusy(false)
  }

  async function wearThis(index: number) {
    const outfit = result?.outfits[index]
    if (!outfit) return
    const err = await logWornToday(outfit.item_ids)
    if (err) setError(err)
    else { setWorn(index); reload() }
  }

  const byId = new Map(items.map(i => [i.id, i]))

  return (
    <div className='mx-auto max-w-5xl space-y-4 p-4'>
      <div>
        <h1 className='text-2xl font-bold'>Outfits for an event</h1>
        <p className='text-sm text-muted'>Tell the AI where you are going. It builds outfits from your own wardrobe.</p>
      </div>

      <Card className='space-y-3'>
        <textarea rows={2} required aria-required='true' value={event} onChange={e => setEvent(e.target.value)}
          placeholder="e.g. friend's wedding, outdoors, evening"
          className='w-full rounded-lg border border-ink/20 bg-surface p-2 text-sm focus:border-brand focus:outline-none' />
        <div className='flex flex-wrap gap-2'>
          {THEMES.map(t => (
            <button key={t} type='button' onClick={() => setEvent(t)}
              className='rounded-full border border-ink/20 px-3 py-1 text-sm hover:bg-ink/5'>{t}</button>
          ))}
        </div>
        <div className='grid grid-cols-2 gap-3'>
          <Select label='Weather (optional)' value={weather} onChange={e => setWeather(e.target.value)}>
            <option value=''>Let the AI decide</option>
            {SEASONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Select label='Dress code (optional)' value={formality} onChange={e => setFormality(e.target.value)}>
            <option value=''>Let the AI decide</option>
            {FORMALITY.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
        <div className='space-y-3'>
          <Select label='Outerwear (jacket, blazer)' value={outerwear}
            onChange={e => setOuterwear(e.target.value as 'auto' | 'yes' | 'no')}>
            <option value='auto'>Only if cool or rainy</option>
            <option value='yes'>Always add one</option>
            <option value='no'>No outerwear</option>
          </Select>
          <div>
            <span className='mb-1 block text-sm font-medium'>Accessories (pick any, one of each is added)</span>
            <div className='flex flex-wrap gap-2'>
              {ACCESSORY_TYPES.map(t => {
                const on = accessories.includes(t.value)
                const have = ready.filter(i => i.category === 'accessory' && (i.subtype ?? 'other') === t.value).length
                return (
                  <button key={t.value} type='button' aria-pressed={on} title={t.hint}
                    onClick={() => setAccessories(on ? accessories.filter(x => x !== t.value) : [...accessories, t.value])}
                    className={`rounded-full border px-3 py-1 text-sm ${
                      on ? 'border-brand bg-brand text-white' : 'border-ink/20 bg-surface hover:bg-ink/5'} ${have === 0 && !on ? 'opacity-50' : ''}`}>
                    {t.label} ({have})
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-3'>
          <Button onClick={() => void suggest()} disabled={busy || loading || ready.length === 0 || !event.trim()}>
            {busy ? 'Thinking...' : 'Suggest outfits'}
          </Button>
          {!event.trim() && ready.length > 0 && <span className='text-sm text-muted'>Describe the event to continue.</span>}
          {missing > 0 && (
            <Button variant='secondary' onClick={() => void prepareOld()} disabled={!!prep}>
              {prep || `Prepare ${missing} item${missing > 1 ? 's' : ''} for the AI`}
            </Button>
          )}
        </div>
        {ready.length === 0 && !loading && (
          <p className='text-sm text-muted'>No item is ready yet. Upload items with the AI service running, or press Prepare.</p>
        )}
      </Card>

      {(error || loadError) && <p className='text-sm text-red-600'>{error || loadError}</p>}

      {result && (
        <div className='space-y-3'>
          <p className='text-sm text-muted'>
            Read as: {labelOf(FORMALITY, result.formality)} · {labelOf(SEASONS, result.weather)}
          </p>
          {result.message && <Card>{result.message}</Card>}
          {result.notes?.map(n => <p key={n} className='text-sm text-muted'>{n}</p>)}
          {result.outfits.map((o, idx) => (
            <Card key={idx} className='space-y-3'>
              <div className='flex items-center justify-between'>
                <p className='font-semibold'>Option {idx + 1}</p>
                <span className='text-sm text-muted'>match {Math.round(o.score * 100)}%</span>
              </div>
              <div className='grid grid-cols-2 gap-3 md:grid-cols-5'>
                {o.item_ids.map(id => {
                  const it = byId.get(id)
                  return it ? (
                    <div key={id} className='text-sm'>
                      {it.image_url && <img src={it.image_url} alt={it.name} className='aspect-[4/5] w-full rounded object-cover' />}
                      <p className='mt-1 font-medium'>{it.name}</p>
                    </div>
                  ) : null
                })}
              </div>
              <p className='text-sm'>{o.reason}</p>
              <div className='flex flex-wrap items-center gap-2'>
                <Button variant={worn === idx ? 'secondary' : 'primary'} disabled={worn === idx}
                  onClick={() => void wearThis(idx)}>
                  {worn === idx ? 'Logged as worn today' : 'Wear this'}
                </Button>
                <Button
                  variant='secondary'
                  onClick={() => navigate(`/visualizer?items=${encodeURIComponent(o.item_ids.join(','))}`)}
                >
                  Preview in 3D Try-on
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
