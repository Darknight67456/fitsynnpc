import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Button from '../../components/Button'
import Card from '../../components/Card'
import type { ClothingItem } from '../../types'
import { useFittingRoomItems } from './useFittingRoomItems'
import { useSavedLooks, type SavedLook } from './useSavedLooks'

/** Outfits → Saved looks: every look saved in the fitting room, each reopenable there. */
export default function SavedLooks() {
  const { byId, thumbOf, ready } = useFittingRoomItems()
  const { looks, loading, deleteLook } = useSavedLooks()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState('')
  const sectionRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (location.hash === '#saved-looks') sectionRef.current?.scrollIntoView({ block: 'start' })
  }, [location.hash])

  function open(look: SavedLook) {
    navigate(`/visualizer?items=${encodeURIComponent(look.item_ids.join(','))}`)
  }

  async function remove(look: SavedLook) {
    setError(await deleteLook(look))
  }

  return (
    <section id='saved-looks' ref={sectionRef} className='scroll-mt-20 space-y-3' aria-labelledby='saved-looks-heading'>
      <div className='flex items-end justify-between gap-2'>
        <div>
          <h2 id='saved-looks-heading' className='text-xl font-bold'>
            Saved looks
          </h2>
          <p className='text-sm text-muted'>Outfits you saved in the fitting room. Open one to see it again.</p>
        </div>
        <span className='text-sm text-muted'>{looks.length} saved</span>
      </div>
      {error && (
        <p className='text-sm text-red-700' role='alert'>
          {error}
        </p>
      )}
      {(loading || !ready) && looks.length === 0 ? (
        <p className='text-sm text-muted'>Loading saved looks…</p>
      ) : looks.length === 0 ? (
        <Card className='text-sm text-muted'>
          No saved looks yet. Choose an outfit in Try-on and press Save look.
        </Card>
      ) : (
        <ul className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {looks.map(look => {
            const items = look.item_ids.map(id => byId.get(id)).filter((i): i is ClothingItem => Boolean(i))
            const name = items.map(i => i.name).join(' + ') || 'Items no longer available'
            return (
              <li key={`${look.where}-${look.id}`}>
                <Card className='flex h-full flex-col gap-3'>
                  <div className='flex gap-1.5'>
                    {items.slice(0, 4).map(it => {
                      const img = thumbOf(it)
                      return img ? (
                        <img key={it.id} src={img} alt='' className='h-20 w-16 rounded-lg border border-ink/10 object-cover' />
                      ) : (
                        <span key={it.id} className='h-20 w-16 rounded-lg border border-ink/10' style={{ backgroundColor: it.color }} />
                      )
                    })}
                  </div>
                  <div className='min-w-0'>
                    <p className='line-clamp-2 text-sm font-semibold'>{look.occasion || name}</p>
                    <p className='text-xs text-muted'>
                      {look.where === 'device' ? 'Saved on this device' : 'Saved to your account'} ·{' '}
                      {new Date(look.created_at).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <div className='mt-auto flex gap-2'>
                    <Button className='flex-1' onClick={() => open(look)} disabled={items.length === 0}>
                      Open in fitting room
                    </Button>
                    <Button variant='secondary' onClick={() => void remove(look)} aria-label={`Remove ${name}`}>
                      Remove
                    </Button>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
