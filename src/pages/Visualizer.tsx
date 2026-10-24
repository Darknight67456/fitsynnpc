import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { seedItems } from '../data/seed'
import { useWardrobe } from '../modules/wardrobe/useWardrobe'
import { useBodyProfile } from '../modules/profile/useBodyProfile'
import BodyProfileForm from '../modules/profile/BodyProfileForm'
import Avatar3D from '../modules/avatar/Avatar3D'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import Button from '../components/Button'
import type { Category, ClothingItem } from '../types'

// Only these categories are drawn on the avatar.
const WEARABLE: Category[] = ['top', 'bottom', 'outerwear', 'shoes']

export default function Visualizer() {
  const { items, loading } = useWardrobe()
  const { profile, setProfile, save } = useBodyProfile()
  const [useSamples, setUseSamples] = useState(false)
  const [wearing, setWearing] = useState<Partial<Record<Category, ClothingItem>>>({})
  const [spin, setSpin] = useState(false)
  const [message, setMessage] = useState('')

  const source = useSamples ? seedItems : items
  const worn = Object.values(wearing)

  // Tap an item to wear it (replacing the one in the same category). Tap again to take it off.
  function toggle(item: ClothingItem) {
    setWearing(prev => {
      const next = { ...prev }
      if (prev[item.category]?.id === item.id) delete next[item.category]
      else next[item.category] = item
      return next
    })
  }

  async function saveProfile() {
    const err = await save(profile)
    setMessage(err || 'Measurements saved.')
  }

  async function saveLook() {
    if (useSamples) { setMessage('Sample clothes cannot be saved. Turn them off first.'); return }
    const { error } = await supabase.from('outfits').insert({ item_ids: worn.map(i => i.id) })
    setMessage(error ? error.message : 'Look saved.')
  }

  return (
    <>
      <PageHeader title='Try-on' subtitle='See your outfit on a 3D avatar built from your measurements.'>
        <Button variant='secondary' onClick={() => setUseSamples(!useSamples)}>
          {useSamples ? 'Use my clothes' : 'Use sample clothes'}
        </Button>
      </PageHeader>

      <div className='grid gap-4 md:grid-cols-2'>
        <div className='space-y-4'>
          <Card>
            <h2 className='mb-2 font-semibold'>Choose clothes</h2>
            {loading && !useSamples && <p className='text-sm text-muted'>Loading...</p>}
            {WEARABLE.map(cat => {
              const list = source.filter(i => i.category === cat)
              return (
                <div key={cat} className='mb-3'>
                  <p className='mb-1 text-sm font-medium capitalize'>{cat}</p>
                  {list.length === 0 && <p className='text-sm text-muted'>None yet.</p>}
                  <div className='flex flex-wrap gap-2'>
                    {list.map(item => (
                      <button key={item.id} onClick={() => toggle(item)} title={item.name}
                        className={`h-16 w-14 overflow-hidden rounded-lg border-2 ${wearing[cat]?.id === item.id ? 'border-brand' : 'border-transparent'}`}
                        style={{ backgroundColor: item.color }}>
                        {item.image_url && <img src={item.image_url} alt={item.name} className='h-full w-full object-cover' />}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </Card>

          <Card>
            <h2 className='mb-2 font-semibold'>Your measurements</h2>
            <BodyProfileForm profile={profile} onChange={setProfile} />
            <Button className='mt-3' onClick={saveProfile}>Save measurements</Button>
          </Card>
        </div>

        <Card className='space-y-2'>
          <Avatar3D profile={profile} worn={worn} autoRotate={spin} />
          <div className='flex flex-wrap gap-2'>
            <Button variant='secondary' onClick={() => setSpin(!spin)}>{spin ? 'Stop rotating' : 'Auto-rotate'}</Button>
            <Button variant='secondary' onClick={() => setWearing({})}>Clear</Button>
            <Button onClick={saveLook} disabled={worn.length === 0}>Save look</Button>
          </div>
          {message && <p className='text-sm text-muted'>{message}</p>}
        </Card>
      </div>
    </>
  )
}
