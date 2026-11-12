import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { seedItems } from '../data/seed'
import { useWardrobe } from '../modules/wardrobe/useWardrobe'
import { useBodyProfile } from '../modules/profile/useBodyProfile'
import BodyProfileForm from '../modules/profile/BodyProfileForm'
import Avatar3D, { type FrontCaptureFn } from '../modules/avatar/Avatar3D'
import AiTryOnPanel, { type GarmentOrigin } from '../modules/tryon/AiTryOnPanel'
import GarmentPicker, { type GarmentSourceId } from '../modules/fittingRoom/GarmentPicker'
import { addDeviceLook, readDeviceLooks, removeDeviceLook, type DeviceLook } from '../modules/fittingRoom/deviceLooks'
import { useDemoCatalog } from '../modules/catalog/useDemoCatalog'
import { useCatalogColors } from '../modules/catalog/useCatalogColors'
import { setRightsConfirmed } from '../modules/catalog/catalogReview'
import { DEMO_ITEM_PREFIX, toDemoMeta, toTryOnClothingItem } from '../modules/catalog/demoGarment'
import type { DemoGarmentMeta } from '../modules/catalog/catalogTypes'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import Button from '../components/Button'
import type { Category, ClothingItem } from '../types'

// Order garments are layered on the mannequin and listed in the outfit strip.
const WEARABLE: Category[] = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory']

interface SavedOutfitRow {
  id: string
  item_ids: string[]
  occasion: string | null
  color_score: number | null
  created_at: string
}

type LookRow = { id: string; item_ids: string[]; created_at: string; occasion?: string | null; where: 'account' | 'device' }

/** Puts an item into an outfit; a dress replaces top + bottom and the other way round. */
function wearInto(outfit: Partial<Record<Category, ClothingItem>>, item: ClothingItem) {
  outfit[item.category] = item
  if (item.category === 'dress') {
    delete outfit.top
    delete outfit.bottom
  } else if (item.category === 'top' || item.category === 'bottom') {
    delete outfit.dress
  }
}

export default function Visualizer() {
  const { items, loading } = useWardrobe()
  const { profile, setProfile, save } = useBodyProfile()
  const [searchParams, setSearchParams] = useSearchParams()
  const demoGarmentParam = searchParams.get('demoGarment')
  const [pickerSource, setPickerSource] = useState<GarmentSourceId>(demoGarmentParam ? 'catalog' : 'wardrobe')
  const [wearing, setWearing] = useState<Partial<Record<Category, ClothingItem>>>({})
  const [spin, setSpin] = useState(false)
  const [message, setMessage] = useState('')
  const [accountLooks, setAccountLooks] = useState<SavedOutfitRow[]>([])
  const [deviceLooks, setDeviceLooks] = useState<DeviceLook[]>(() => readDeviceLooks())
  const [loadingSaved, setLoadingSaved] = useState(true)
  const [aiTriggerSeq, setAiTriggerSeq] = useState(0)
  const appliedUrlQueryRef = useRef('')
  const appliedDemoRef = useRef('')
  const captureFrontRef = useRef<FrontCaptureFn | null>(null)
  const aiPanelRef = useRef<HTMLDivElement | null>(null)

  // Team clothing dataset: read-only, served from public/demo-catalog, never written to Supabase.
  const demoCatalog = useDemoCatalog()
  const catalogColors = useCatalogColors(demoCatalog.items)
  const catalog = useMemo(() => {
    const garments: ClothingItem[] = []
    const thumbs = new Map<string, string>()
    const meta: Record<string, DemoGarmentMeta> = {}
    for (const item of demoCatalog.items) {
      if (item.status === 'rejected' || !item.category) continue
      const garment = toTryOnClothingItem(item, catalogColors[item.id])
      garments.push(garment)
      thumbs.set(garment.id, item.thumbUrl)
      meta[garment.id] = toDemoMeta(item)
    }
    return { garments, thumbs, meta }
  }, [demoCatalog.items, catalogColors])

  const confirmGarmentRights = useCallback(
    (catalogId: string) => {
      const item = demoCatalog.items.find(i => i.id === catalogId)
      if (item) setRightsConfirmed(item, true)
    },
    [demoCatalog.items]
  )

  const ownedIds = useMemo(() => new Set(items.map(i => i.id)), [items])
  const originOf = useCallback(
    (item: ClothingItem): GarmentOrigin =>
      ownedIds.has(item.id) ? 'wardrobe' : item.id.startsWith(DEMO_ITEM_PREFIX) ? 'demo_catalog' : 'sample',
    [ownedIds]
  )

  const allItemsById = useMemo(() => {
    const map = new Map<string, ClothingItem>()
    for (const s of seedItems) map.set(s.id, s)
    for (const g of catalog.garments) map.set(g.id, g)
    for (const i of items) map.set(i.id, i)
    return map
  }, [items, catalog.garments])

  const worn = WEARABLE.map(cat => wearing[cat]).filter((i): i is ClothingItem => Boolean(i))
  const wornIds = useMemo(() => new Set(worn.map(i => i.id)), [worn])

  const handleRegisterFrontCapture = useCallback((captureFn: FrontCaptureFn) => {
    captureFrontRef.current = captureFn
  }, [])
  const captureFrontMannequin = useCallback<FrontCaptureFn>(async options => {
    if (!captureFrontRef.current) {
      throw new Error('The 3D mannequin is still loading. Try again in a moment.')
    }
    return captureFrontRef.current(options)
  }, [])

  const fetchAccountLooks = useCallback(async () => {
    setLoadingSaved(true)
    const { data, error } = await supabase
      .from('outfits')
      .select('id, item_ids, occasion, color_score, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    if (!error && data) setAccountLooks(data as SavedOutfitRow[])
    setLoadingSaved(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAccountLooks()
  }, [fetchAccountLooks])

  // Outfits and Colors pages send recommended looks here as ?items=id1,id2
  const itemsQuery = searchParams.get('items') ?? ''
  useEffect(() => {
    if (!itemsQuery || loading || appliedUrlQueryRef.current === itemsQuery) return
    const ids = itemsQuery.split(',').map(s => s.trim()).filter(Boolean)
    if (ids.length === 0) return
    appliedUrlQueryRef.current = itemsQuery
    const next: Partial<Record<Category, ClothingItem>> = {}
    let count = 0
    for (const id of ids) {
      const found = allItemsById.get(id)
      if (!found) continue
      wearInto(next, found)
      count++
    }
    if (count > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWearing(next)
      setMessage(`Loaded ${count} recommended item${count > 1 ? 's' : ''} onto your mannequin.`)
    }
  }, [itemsQuery, loading, allItemsById])

  // Catalog page "Try on" sends ?demoGarment=<catalog id>
  useEffect(() => {
    if (!demoGarmentParam || appliedDemoRef.current === demoGarmentParam) return
    const garment = allItemsById.get(`${DEMO_ITEM_PREFIX}${demoGarmentParam}`)
    if (!garment) return
    appliedDemoRef.current = demoGarmentParam
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWearing(prev => {
      const next = { ...prev }
      wearInto(next, garment)
      return next
    })
  }, [demoGarmentParam, allItemsById])

  function toggle(item: ClothingItem) {
    setWearing(prev => {
      const next = { ...prev }
      if (prev[item.category]?.id === item.id) delete next[item.category]
      else wearInto(next, item)
      return next
    })
  }

  const looks: LookRow[] = useMemo(
    () =>
      [
        ...accountLooks.map(l => ({ ...l, where: 'account' as const })),
        ...deviceLooks.map(l => ({ ...l, where: 'device' as const })),
      ].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [accountLooks, deviceLooks]
  )

  function applyLook(look: LookRow) {
    const next: Partial<Record<Category, ClothingItem>> = {}
    let found = 0
    for (const id of look.item_ids ?? []) {
      const item = allItemsById.get(id)
      if (!item) continue
      wearInto(next, item)
      found++
    }
    setWearing(next)
    if (searchParams.has('items')) setSearchParams({}, { replace: true })
    const missing = (look.item_ids?.length ?? 0) - found
    setMessage(
      found === 0
        ? 'Those items are no longer available, so this look could not be loaded.'
        : missing > 0
          ? `Look loaded. ${missing} item${missing > 1 ? 's are' : ' is'} no longer available and was skipped.`
          : 'Look loaded onto your mannequin.'
    )
  }

  async function deleteLook(look: LookRow) {
    if (look.where === 'device') {
      setDeviceLooks(removeDeviceLook(look.id))
      setMessage('Look removed.')
      return
    }
    const { error } = await supabase.from('outfits').delete().eq('id', look.id)
    if (error) {
      setMessage(`Could not remove the look: ${error.message}`)
      return
    }
    setAccountLooks(prev => prev.filter(l => l.id !== look.id))
    setMessage('Look removed.')
  }

  async function saveLook() {
    if (worn.length === 0) return
    const allOwned = worn.every(i => originOf(i) === 'wardrobe')
    if (allOwned) {
      const { error } = await supabase.from('outfits').insert({ item_ids: worn.map(i => i.id) })
      if (error) {
        setMessage(`Could not save the look: ${error.message}`)
        return
      }
      setMessage('Look saved to your account.')
      void fetchAccountLooks()
      return
    }
    // Catalog and sample garments are not in your wardrobe table, so keep this look on the device.
    const next = addDeviceLook(worn.map(i => i.id))
    if (!next) {
      setMessage('This browser is blocking storage, so the look could not be saved.')
      return
    }
    setDeviceLooks(next)
    setMessage('Look saved on this device. It includes catalog or sample clothes, so it is not added to your account.')
  }

  async function saveProfile() {
    const err = await save(profile)
    setMessage(err ? `Could not save measurements: ${err}` : 'Measurements saved.')
  }

  return (
    <>
      <PageHeader
        title='Fitting room'
        subtitle='Dress your measurement-based mannequin, then turn the look into an AI try-on photo.'
      />

      <div className='grid items-start gap-4 lg:grid-cols-12'>
        {/* Mannequin + outfit: first on phones, right-hand side on desktop */}
        <div className='space-y-4 lg:order-2 lg:col-span-7'>
          <Card className='space-y-3'>
            <Avatar3D
              profile={profile}
              worn={worn}
              autoRotate={spin}
              onAutoRotateChange={setSpin}
              onRegisterFrontCapture={handleRegisterFrontCapture}
            />

            <div>
              <div className='mb-1.5 flex items-center justify-between'>
                <h2 className='text-sm font-semibold'>Wearing ({worn.length})</h2>
                {worn.length > 0 && <span className='text-xs text-muted'>Tap an item to take it off</span>}
              </div>
              {worn.length === 0 ? (
                <p className='text-sm text-muted'>Pick clothes from the rail to dress the mannequin.</p>
              ) : (
                <ul className='flex flex-wrap gap-2'>
                  {worn.map(item => (
                    <li key={item.id}>
                      <button
                        type='button'
                        onClick={() => toggle(item)}
                        title={`Take off ${item.name}`}
                        className='flex items-center gap-2 rounded-lg border border-ink/10 bg-surface py-1 pl-1 pr-2.5 text-left text-xs transition hover:border-red-300 hover:bg-red-50/50'
                      >
                        {item.image_url ? (
                          <img
                            src={catalog.thumbs.get(item.id) ?? item.image_url}
                            alt=''
                            className='h-8 w-8 rounded object-cover'
                          />
                        ) : (
                          <span className='h-8 w-8 rounded' style={{ backgroundColor: item.color }} />
                        )}
                        <span className='leading-tight'>
                          <span className='block max-w-40 truncate font-medium'>{item.name}</span>
                          <span className='capitalize text-muted'>
                            {item.category}
                            {originOf(item) === 'demo_catalog' ? ' · catalog' : originOf(item) === 'sample' ? ' · sample' : ''}
                          </span>
                        </span>
                        <span className='text-muted' aria-hidden='true'>×</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div className='flex flex-wrap gap-2'>
                <Button variant='secondary' onClick={() => setSpin(!spin)}>
                  {spin ? 'Stop rotating' : 'Rotate'}
                </Button>
                <Button variant='secondary' onClick={() => setWearing({})} disabled={worn.length === 0}>
                  Clear outfit
                </Button>
              </div>
              <div className='flex flex-wrap gap-2'>
                <Button
                  variant='secondary'
                  disabled={worn.length === 0}
                  onClick={() => {
                    aiPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                    setAiTriggerSeq(s => s + 1)
                  }}
                >
                  Make AI photo
                </Button>
                <Button onClick={() => void saveLook()} disabled={worn.length === 0}>
                  Save look
                </Button>
              </div>
            </div>
            {message && (
              <p className='text-sm text-muted' role='status'>
                {message}
              </p>
            )}
          </Card>

          <div ref={aiPanelRef}>
            <AiTryOnPanel
              garments={worn}
              originOf={originOf}
              demoMeta={catalog.meta}
              onConfirmRights={confirmGarmentRights}
              onCaptureFrontMannequin={captureFrontMannequin}
              triggerSeq={aiTriggerSeq}
            />
          </div>
        </div>

        {/* Clothes rail, saved looks, measurements */}
        <div className='space-y-4 lg:order-1 lg:col-span-5'>
          <Card>
            <h2 className='mb-3 font-semibold'>Clothes</h2>
            <GarmentPicker
              activeSource={pickerSource}
              onSourceChange={setPickerSource}
              wornIds={wornIds}
              onToggle={toggle}
              thumbs={catalog.thumbs}
              sources={[
                {
                  id: 'wardrobe',
                  label: 'My wardrobe',
                  items,
                  loading,
                  empty: (
                    <>
                      Your wardrobe is empty.{' '}
                      <Link to='/wardrobe' className='font-medium text-brand underline'>
                        Add your clothes
                      </Link>{' '}
                      or try the Catalog.
                    </>
                  ),
                },
                {
                  id: 'catalog',
                  label: 'Catalog',
                  items: catalog.garments,
                  loading: demoCatalog.state === 'loading',
                  note: (
                    <>
                      FitSync team dataset, shown to everyone and never added to your wardrobe. Categories are
                      suggestions until reviewed in the{' '}
                      <Link to='/catalog' className='font-medium text-brand underline'>
                        Catalog
                      </Link>
                      .
                    </>
                  ),
                  empty: (
                    <>
                      The catalog is not installed on this build.{' '}
                      <Link to='/catalog' className='font-medium text-brand underline'>
                        Open the Catalog
                      </Link>{' '}
                      for setup steps.
                    </>
                  ),
                },
                {
                  id: 'samples',
                  label: 'Samples',
                  items: seedItems,
                  note: 'Colour-block placeholders for quick outfit ideas. They have no photo, so AI try-on skips them.',
                  empty: 'No sample clothes.',
                },
              ]}
            />
          </Card>

          <Card>
            <div className='mb-2 flex items-center justify-between'>
              <h2 className='font-semibold'>Saved looks</h2>
              <span className='text-xs text-muted'>{looks.length} saved</span>
            </div>
            {loadingSaved && looks.length === 0 ? (
              <p className='text-sm text-muted'>Loading saved looks…</p>
            ) : looks.length === 0 ? (
              <p className='text-sm text-muted'>
                No saved looks yet. Dress the mannequin and press Save look, or open a suggestion from{' '}
                <Link to='/outfits' className='font-medium text-brand underline'>
                  Outfits
                </Link>
                .
              </p>
            ) : (
              <ul className='max-h-72 space-y-2 overflow-y-auto pr-1'>
                {looks.map(look => {
                  const resolved = look.item_ids
                    .map(id => allItemsById.get(id))
                    .filter((i): i is ClothingItem => Boolean(i))
                  return (
                    <li key={`${look.where}-${look.id}`} className='flex items-center gap-2 rounded-lg border border-ink/10 p-2 text-xs'>
                      <button
                        type='button'
                        onClick={() => applyLook(look)}
                        className='flex min-w-0 flex-1 items-center gap-2 text-left'
                        title='Put this look on the mannequin'
                      >
                        <span className='flex -space-x-2'>
                          {resolved.slice(0, 4).map(it =>
                            it.image_url ? (
                              <img
                                key={it.id}
                                src={catalog.thumbs.get(it.id) ?? it.image_url}
                                alt=''
                                className='h-8 w-8 rounded-full border-2 border-surface object-cover'
                              />
                            ) : (
                              <span
                                key={it.id}
                                className='h-8 w-8 rounded-full border-2 border-surface'
                                style={{ backgroundColor: it.color }}
                              />
                            )
                          )}
                        </span>
                        <span className='min-w-0'>
                          <span className='block truncate font-medium'>
                            {look.occasion || resolved.map(i => i.name).join(', ') || 'Items no longer available'}
                          </span>
                          <span className='text-muted'>
                            {look.where === 'device' ? 'This device' : 'Your account'} ·{' '}
                            {new Date(look.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        </span>
                      </button>
                      <button
                        type='button'
                        onClick={() => void deleteLook(look)}
                        className='rounded px-2 py-1 text-muted hover:bg-red-50 hover:text-red-700'
                        aria-label='Remove saved look'
                        title='Remove saved look'
                      >
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className='mb-1 font-semibold'>Body measurements</h2>
            <p className='mb-3 text-sm text-muted'>
              The mannequin is built from these numbers only. No body photo is taken.
            </p>
            <BodyProfileForm profile={profile} onChange={setProfile} />
            <Button className='mt-3' onClick={() => void saveProfile()}>
              Save measurements
            </Button>
          </Card>
        </div>
      </div>
    </>
  )
}
