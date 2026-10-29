import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import Button from '../../components/Button'
import Card from '../../components/Card'
import { detectMainColor, removePhotoBackground } from './photoTools'
import { embedImage, suggestTags } from '../../lib/ai'
import TagFields from './TagFields'
import { DEFAULT_TAGS, type Tags } from './options'
import { applySuggestion, findSimilar } from './suggest'
import type { ClothingItem } from '../../types'

export default function UploadForm({ onSaved, items = [] }: { onSaved: () => void; items?: ClothingItem[] }) {
  const { user } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [cutout, setCutout] = useState<Blob | null>(null)      // photo with the background removed
  const [removing, setRemoving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [tags, setTags] = useState<Tags>(DEFAULT_TAGS)
  const [suggested, setSuggested] = useState<string[]>([])       // fields the AI filled in (nothing is saved yet)
  const [reading, setReading] = useState(false)
  const [similar, setSimilar] = useState<{ item: ClothingItem; similarity: number }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The picture we show and upload: the cutout if there is one, otherwise the original.
  const shown: Blob | null = cutout ?? file
  const preview = useMemo(() => (shown ? URL.createObjectURL(shown) : ''), [shown])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  // When the user edits a field, it is no longer "an AI suggestion".
  function changeTags(next: Tags) {
    setSuggested(s => s.filter(k => JSON.stringify(next[k as keyof Tags]) === JSON.stringify(tags[k as keyof Tags])))
    setTags(next)
  }

  // Ask the AI to read the photo. It only fills the form: the user checks and edits, and nothing is saved.
  async function readPhoto(f: File) {
    setReading(true)
    try {
      const r = await suggestTags(f)
      let filled: string[] = []
      setTags(t => {
        const out = applySuggestion(t, r)
        filled = out.filled
        return out.next
      })
      setSuggested(filled)
      setSimilar(findSimilar(r.embedding, items))
    } catch {
      /* the AI service is off or busy: the form still works by hand */
    }
    setReading(false)
  }

  async function pickPhoto(f: File | null) {
    setFile(f)
    setCutout(null)
    setError('')
    setSuggested([])
    setSimilar([])
    if (!f) return
    setTags({ ...DEFAULT_TAGS })
    try {
      const color = await detectMainColor(f)                   // pre-fill the color
      setTags(t => ({ ...t, color }))
    } catch {
      /* if detection fails the user just picks the color by hand */
    }
    void readPhoto(f)
  }

  async function removeBackground() {
    if (!file) return
    setRemoving(true)
    setProgress(0)
    setError('')
    try {
      const result = await removePhotoBackground(file, setProgress)
      setCutout(result)
      const color = await detectMainColor(result)              // re-detect: now only the clothing remains
      setTags(t => ({ ...t, color }))
    } catch {
      setError('Background removal failed. You can still save the original photo.')
    }
    setRemoving(false)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    if (!file || !shown) { setError('Please choose a photo first.'); return }
    if (tags.category === 'accessory' && !tags.subtype) { setError('Choose the type of accessory (bag, watch...).'); return }
    setBusy(true)
    setError('')

    const ext = cutout ? 'png' : (file.name.split('.').pop() ?? 'jpg')
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`
    const up = await supabase.storage.from('wardrobe-images').upload(path, shown, {
      contentType: cutout ? 'image/png' : file.type,
    })
    if (up.error) { setError(up.error.message); setBusy(false); return }
    const { data } = supabase.storage.from('wardrobe-images').getPublicUrl(path)

    // Ask the AI service for the item's fingerprint. If it is not running, save anyway;
    // the Outfits page can prepare the item later.
    let ai = {}
    try { ai = await embedImage(shown) } catch { /* AI service offline */ }

    const ins = await supabase.from('clothing_items').insert({ ...tags, image_url: data.publicUrl, ...ai })
    setBusy(false)
    if (ins.error) { setError(ins.error.message); return }

    setFile(null)
    setCutout(null)
    setTags(DEFAULT_TAGS)
    onSaved()
  }

  return (
    <Card>
      <form onSubmit={save} className='space-y-4'>
        <div>
          <span className='mb-1 block text-sm font-medium'>1. Photo of the item</span>
          <input type='file' accept='image/*' onChange={e => void pickPhoto(e.target.files?.[0] ?? null)} />
        </div>

        {shown && (
          <div className='space-y-2'>
            {/* checkerboard behind the picture so you can see a transparent background */}
            <img src={preview} alt='preview' className='h-44 rounded'
              style={{ backgroundImage: 'repeating-conic-gradient(#e5e5e5 0% 25%, #fff 0% 50%)', backgroundSize: '16px 16px' }} />
            <div className='flex flex-wrap items-center gap-2'>
              {!cutout && (
                <Button type='button' variant='secondary' disabled={removing} onClick={removeBackground}>
                  {removing ? `Removing background... ${progress}%` : 'Remove background'}
                </Button>
              )}
              {cutout && (
                <Button type='button' variant='secondary' onClick={() => setCutout(null)}>Use original photo</Button>
              )}
              {removing && <span className='text-xs text-muted'>The first time downloads an AI model, so it can take a minute.</span>}
            </div>
          </div>
        )}

        <span className='block text-sm font-medium'>2. Check the tags</span>
        {reading && <p className='text-sm text-muted'>Reading your photo...</p>}
        {suggested.length > 0 && (
          <p className='rounded-lg bg-brand/10 p-2 text-sm'>
            The AI filled in the tags marked "AI suggestion" from your photo. Check them and change anything that is
            wrong. Nothing is saved until you press Add to wardrobe.
          </p>
        )}
        {similar.length > 0 && (
          <div className='rounded-lg border border-ink/10 p-2 text-sm'>
            <p className='mb-1 font-medium'>Looks similar to something you already own:</p>
            <div className='flex gap-3'>
              {similar.map(s => (
                <div key={s.item.id} className='w-20 text-center text-xs'>
                  {s.item.image_url && <img src={s.item.image_url} alt={s.item.name} className='h-20 w-20 rounded object-cover' />}
                  <p className='truncate'>{s.item.name}</p>
                  <p className='text-muted'>{Math.round(s.similarity * 100)}% alike</p>
                </div>
              ))}
            </div>
          </div>
        )}
        <TagFields value={tags} onChange={changeTags} suggested={suggested} />

        {error && <p className='text-sm text-red-600'>{error}</p>}
        <Button disabled={busy || removing}>{busy ? 'Saving...' : 'Add to wardrobe'}</Button>
      </form>
    </Card>
  )
}
