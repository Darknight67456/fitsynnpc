import { useEffect, useMemo, useState } from 'react'
import { assist, type AssistResult } from '../lib/ai'
import { useWardrobe } from '../modules/wardrobe/useWardrobe'
import { colorName } from '../modules/wardrobe/colorFamily'
import { ACCESSORY_TYPES, CATEGORIES, FORMALITY, labelOf } from '../modules/wardrobe/options'
import SelfieCapture from '../modules/stylist/SelfieCapture'
import Button from '../components/Button'
import Card from '../components/Card'

const QUICK = [
  'What bottom fits this shirt?',
  'What shirt fits this bottom?',
  'What shoes go with this?',
  'Suggest accessories',
  'Should I add a jacket?',
]

const nameOf = (category: string, subtype: string | null) =>
  subtype ? labelOf(ACCESSORY_TYPES, subtype) : labelOf(CATEGORIES, category)

export default function Stylist() {
  const { items } = useWardrobe()
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState<AssistResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : ''), [photo])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const ready = items.filter(i => Array.isArray(i.embedding) && i.embedding.length > 0)
  const byId = new Map(items.map(i => [i.id, i]))

  async function ask() {
    if (!photo) { setError('Take or choose a photo first.'); return }
    setError('')
    setResult(null)
    setBusy(true)
    try {
      setResult(await assist(photo, prompt, ready.map(i => ({
        id: i.id, name: i.name, category: i.category, subtype: i.subtype ?? null,
        formality: i.formality, formality_levels: i.formality_levels?.length ? i.formality_levels : [i.formality],
        embedding: i.embedding,
      }))))
    } catch (e) {
      setError(e instanceof Error ? `${e.message} Is the AI service running?` : 'Something went wrong.')
    }
    setBusy(false)
  }

  return (
    <div className='mx-auto max-w-5xl space-y-4 p-4'>
      <div>
        <h1 className='text-2xl font-bold'>Ask the stylist</h1>
        <p className='text-sm text-muted'>
          Take a photo of what you are wearing and ask what goes with it. The AI finds your shirt, bottom, shoes and
          accessories in the photo, then picks matching pieces from your wardrobe.
        </p>
      </div>

      <Card className='space-y-3'>
        <SelfieCapture onPhoto={p => { setPhoto(p); setResult(null) }} />
        {preview && <img src={preview} alt='your photo' className='max-h-72 rounded-lg' />}

        <textarea rows={2} value={prompt} onChange={e => setPrompt(e.target.value)}
          placeholder='Ask anything, e.g. what bottom fits this shirt?'
          className='w-full rounded-lg border border-ink/20 bg-surface p-2 text-sm focus:border-brand focus:outline-none' />
        <div className='flex flex-wrap gap-2'>
          {QUICK.map(q => (
            <button key={q} type='button' onClick={() => setPrompt(q)}
              className='rounded-full border border-ink/20 px-3 py-1 text-sm hover:bg-ink/5'>{q}</button>
          ))}
        </div>
        <Button onClick={() => void ask()} disabled={busy || ready.length === 0}>{busy ? 'Looking...' : 'Ask'}</Button>
        {ready.length === 0 && (
          <p className='text-sm text-muted'>No wardrobe item is ready for the AI yet. Open Outfits and press Prepare first.</p>
        )}
        <p className='text-xs text-muted'>
          Your photo is sent to the AI service to read the clothes and is not saved. If a Gemini or Claude key is set on
          the service, your question and a short description of your outfit (not the photo) are sent to that service too.
        </p>
      </Card>

      {error && <p className='text-sm text-red-600'>{error}</p>}

      {result && (
        <div className='space-y-4'>
          {result.message && <Card>{result.message}</Card>}

          {result.detected.length > 0 && (
            <Card className='space-y-2'>
              <p className='font-semibold'>What I see you wearing</p>
              <div className='flex flex-wrap gap-3'>
                {result.detected.map((d, i) => (
                  <div key={i} className='w-24 text-center text-xs'>
                    <img src={d.image} alt={nameOf(d.category, d.subtype)} className='h-24 w-24 rounded object-contain bg-white' />
                    <p className='mt-1 font-medium'>{nameOf(d.category, d.subtype)}</p>
                    <p className='text-muted'>{colorName(d.color)}</p>
                  </div>
                ))}
              </div>
              {result.formality && (
                <p className='text-sm text-muted'>Looks like: {labelOf(FORMALITY, Math.round(result.formality))}</p>
              )}
            </Card>
          )}

          {result.targets.map(t => (
            <Card key={t.target} className='space-y-2'>
              <p className='font-semibold'>Suggested {nameOf(t.target, ACCESSORY_TYPES.some(a => a.value === t.target) ? t.target : null).toLowerCase()}</p>
              {t.picks.length === 0 && (
                <p className='text-sm text-muted'>You have no {nameOf(t.target, ACCESSORY_TYPES.some(a => a.value === t.target) ? t.target : null).toLowerCase()} in your wardrobe yet.</p>
              )}
              <div className='grid grid-cols-3 gap-3'>
                {t.picks.map(p => {
                  const it = byId.get(p.item_id)
                  return it ? (
                    <div key={p.item_id} className='text-sm'>
                      {it.image_url && <img src={it.image_url} alt={it.name} className='aspect-[4/5] w-full rounded object-cover' />}
                      <p className='mt-1 font-medium'>{it.name}</p>
                      <p className='text-xs text-muted'>match {Math.round(p.score * 100)}%</p>
                    </div>
                  ) : null
                })}
              </div>
              {t.reason && <p className='text-sm'>{t.reason}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
