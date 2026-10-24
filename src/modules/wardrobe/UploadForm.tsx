import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { detectMainColor, removePhotoBackground } from './photoTools'
import type { Category } from '../../types'

const CATEGORIES: Category[] = ['top', 'bottom', 'outerwear', 'shoes', 'accessory']

export default function UploadForm({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [cutout, setCutout] = useState<Blob | null>(null)      // photo with the background removed
  const [removing, setRemoving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('top')
  const [color, setColor] = useState('#000000')
  const [pattern, setPattern] = useState('plain')
  const [fabric, setFabric] = useState('')
  const [season, setSeason] = useState('all')
  const [formality, setFormality] = useState(3)
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
      setColor(await detectMainColor(f))                       // pre-fill the color picker
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
      setColor(await detectMainColor(result))                  // re-detect: now only the clothing remains
    } catch {
      setError('Background removal failed. You can still save the original photo.')
    }
    setRemoving(false)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    if (!file || !shown) { setError('Please choose a photo.'); return }
    setBusy(true)
    setError('')

    const ext = cutout ? 'png' : (file.name.split('.').pop() ?? 'jpg')
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`
    const up = await supabase.storage.from('wardrobe-images').upload(path, shown, {
      contentType: cutout ? 'image/png' : file.type,
    })
    if (up.error) { setError(up.error.message); setBusy(false); return }
    const { data } = supabase.storage.from('wardrobe-images').getPublicUrl(path)

    const ins = await supabase.from('clothing_items').insert({
      name, category, color, pattern, fabric, season, formality, image_url: data.publicUrl,
    })
    setBusy(false)
    if (ins.error) { setError(ins.error.message); return }

    setFile(null)
    setCutout(null)
    setName('')
    onSaved()
  }

  const input = 'w-full rounded border p-2'
  return (
    <form onSubmit={save} className='space-y-2 rounded border p-4'>
      <input type='file' accept='image/*' onChange={e => void pickPhoto(e.target.files?.[0] ?? null)} />

      {shown && (
        <div className='space-y-2'>
          {/* checkerboard behind the picture so you can see the transparent background */}
          <img src={preview} alt='preview' className='h-40 rounded'
            style={{ backgroundImage: 'repeating-conic-gradient(#e5e5e5 0% 25%, #fff 0% 50%)', backgroundSize: '16px 16px' }} />
          <div className='flex flex-wrap items-center gap-2'>
            {!cutout && (
              <button type='button' className='rounded border px-3 py-1 text-sm disabled:opacity-50'
                disabled={removing} onClick={removeBackground}>
                {removing ? `Removing background... ${progress}%` : 'Remove background'}
              </button>
            )}
            {cutout && (
              <button type='button' className='rounded border px-3 py-1 text-sm' onClick={() => setCutout(null)}>
                Use original photo
              </button>
            )}
            {removing && <span className='text-xs text-gray-500'>The first time downloads an AI model, so it can take a minute.</span>}
          </div>
        </div>
      )}

      <input className={input} required placeholder='Name (e.g. Navy blazer)' value={name}
        onChange={e => setName(e.target.value)} />
      <select className={input} value={category} onChange={e => setCategory(e.target.value as Category)}>
        {CATEGORIES.map(c => <option key={c}>{c}</option>)}
      </select>
      <label className='flex items-center gap-2'>Color (detected from the photo, change it if it is wrong)
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
      <button className='rounded bg-black px-4 py-2 text-white disabled:opacity-50' disabled={busy || removing}>
        {busy ? 'Saving...' : 'Add to wardrobe'}
      </button>
    </form>
  )
}
