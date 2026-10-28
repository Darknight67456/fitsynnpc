import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import Button from '../../components/Button'
import Card from '../../components/Card'
import { detectMainColor, removePhotoBackground } from './photoTools'
import { embedImage } from '../../lib/ai'
import TagFields from './TagFields'
import { DEFAULT_TAGS, type Tags } from './options'

export default function UploadForm({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [cutout, setCutout] = useState<Blob | null>(null)      // photo with the background removed
  const [removing, setRemoving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [tags, setTags] = useState<Tags>(DEFAULT_TAGS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The picture we show and upload: the cutout if there is one, otherwise the original.
  const shown: Blob | null = cutout ?? file
  const preview = useMemo(() => (shown ? URL.createObjectURL(shown) : ''), [shown])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  async function pickPhoto(f: File | null) {
    setFile(f)
    setCutout(null)
    setError('')
    if (!f) return
    try {
      const color = await detectMainColor(f)                   // pre-fill the color
      setTags(t => ({ ...t, color }))
    } catch {
      /* if detection fails the user just picks the color by hand */
    }
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

        <span className='block text-sm font-medium'>2. Tag it</span>
        <TagFields value={tags} onChange={setTags} />

        {error && <p className='text-sm text-red-600'>{error}</p>}
        <Button disabled={busy || removing}>{busy ? 'Saving...' : 'Add to wardrobe'}</Button>
      </form>
    </Card>
  )
}
