import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useBodyProfile } from '../modules/profile/useBodyProfile'
import BodyMeasurementsEditor from '../modules/profile/BodyMeasurementsEditor'
import Avatar3D, { type FrontCaptureFn } from '../modules/avatar/Avatar3D'
import { PREVIEW_FRAME_HEIGHT } from '../modules/avatar/previewFrame'
import AiTryOnPanel from '../modules/tryon/AiTryOnPanel'
import GarmentPicker, { type GarmentSourceId } from '../modules/fittingRoom/GarmentPicker'
import { useFittingRoomItems } from '../modules/fittingRoom/useFittingRoomItems'
import { useSavedLooks } from '../modules/fittingRoom/useSavedLooks'
import { setRightsConfirmed } from '../modules/catalog/catalogReview'
import { DEMO_ITEM_PREFIX } from '../modules/catalog/demoGarment'
import SidePanel from '../components/SidePanel'
import Card from '../components/Card'
import Button from '../components/Button'
import type { Category, ClothingItem } from '../types'

// Order garments are layered on the mannequin and listed in the outfit name.
const WEARABLE: Category[] = ['dress', 'top', 'bottom', 'outerwear', 'shoes', 'accessory']
// The current outfit survives a visit to another page for this browser tab.
const OUTFIT_KEY = 'fitsync.fittingRoom.outfit'

type Outfit = Partial<Record<Category, ClothingItem>>

/** Puts an item into an outfit; a dress replaces top + bottom and the other way round. */
function wearInto(outfit: Outfit, item: ClothingItem) {
  outfit[item.category] = item
  if (item.category === 'dress') {
    delete outfit.top
    delete outfit.bottom
  } else if (item.category === 'top' || item.category === 'bottom') {
    delete outfit.dress
  }
}

function outfitFromIds(ids: string[], byId: Map<string, ClothingItem>): { outfit: Outfit; found: number } {
  const outfit: Outfit = {}
  let found = 0
  for (const id of ids) {
    const item = byId.get(id)
    if (!item) continue
    wearInto(outfit, item)
    found++
  }
  return { outfit, found }
}

function readStoredOutfit(): string[] {
  try {
    const raw = sessionStorage.getItem(OUTFIT_KEY)
    const ids: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(ids) ? ids.filter((i): i is string => typeof i === 'string') : []
  } catch {
    return []
  }
}

export default function Visualizer() {
  const [searchParams] = useSearchParams()
  const demoGarmentParam = searchParams.get('demoGarment')
  const itemsParam = searchParams.get('items')
  // The outfit this visit opens with: from the URL (Catalog "Try on", Outfits "Open"), else the last one.
  const requestedIds = useMemo(
    () =>
      demoGarmentParam
        ? [`${DEMO_ITEM_PREFIX}${demoGarmentParam}`]
        : itemsParam
          ? itemsParam.split(',').map(s => s.trim()).filter(Boolean)
          : readStoredOutfit(),
    [demoGarmentParam, itemsParam]
  )
  const { wardrobe, demoCatalog, catalog, mannequinGender, originOf, byId, thumbOf, ready } =
    useFittingRoomItems(requestedIds)
  const { profile, setProfile, save } = useBodyProfile()
  const { saveLook } = useSavedLooks()

  const [wearing, setWearing] = useState<Outfit>({})
  const [spin, setSpin] = useState(false)
  const [message, setMessage] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSource, setPickerSource] = useState<GarmentSourceId | null>(null)
  const [measureOpen, setMeasureOpen] = useState(false)
  const [mobileView, setMobileView] = useState<'3d' | 'ai'>('3d')
  const appliedRef = useRef('')
  const captureFrontRef = useRef<FrontCaptureFn | null>(null)

  useEffect(() => {
    if (!ready) return
    const request = demoGarmentParam ? `demo:${demoGarmentParam}` : itemsParam ? `items:${itemsParam}` : 'stored'
    if (appliedRef.current === request) return
    appliedRef.current = request
    const ids = requestedIds
    const { outfit, found } = outfitFromIds(ids, byId)
    const missing = request !== 'stored' ? ids.length - found : 0
    // Applying the requested outfit once the garments are known is the intended side effect.
    setWearing(outfit)
    setMessage(
      missing === 0
        ? ''
        : found === 0
          ? 'Those clothes are no longer available.'
          : `${missing} item${missing > 1 ? 's are' : ' is'} no longer available and was left out.`
    )
  }, [ready, demoGarmentParam, itemsParam, requestedIds, byId])

  // Look each garment up again so it picks up details that arrive later, such as the color
  // read from a catalog photo after the garment was put on (otherwise it stays placeholder grey).
  const worn = useMemo(
    () =>
      WEARABLE.map(cat => wearing[cat])
        .filter((i): i is ClothingItem => Boolean(i))
        .map(i => byId.get(i.id) ?? i),
    [wearing, byId]
  )
  const wornIds = useMemo(() => new Set(worn.map(i => i.id)), [worn])
  const primary = worn[0] ?? null
  const outfitName = worn.length === 0 ? 'No outfit selected' : worn.map(i => i.name).join(' + ')

  useEffect(() => {
    if (!ready) return
    try {
      sessionStorage.setItem(OUTFIT_KEY, JSON.stringify(worn.map(i => i.id)))
    } catch {
      // Storage blocked: the outfit just will not survive leaving the page.
    }
  }, [ready, worn])

  function toggle(item: ClothingItem) {
    setMessage('')
    setWearing(prev => {
      const next = { ...prev }
      if (prev[item.category]?.id === item.id) delete next[item.category]
      else wearInto(next, item)
      return next
    })
  }

  function openPicker() {
    // Catalog first when the wardrobe is empty, otherwise the user's own clothes.
    setPickerSource(prev => prev ?? (wardrobe.items.length === 0 ? 'catalog' : 'wardrobe'))
    setPickerOpen(true)
  }

  async function onSaveLook() {
    if (worn.length === 0) return
    const { message: msg } = await saveLook(
      worn.map(i => i.id),
      worn.every(i => originOf(i) === 'wardrobe')
    )
    setMessage(msg)
  }

  const handleRegisterFrontCapture = useCallback((captureFn: FrontCaptureFn) => {
    captureFrontRef.current = captureFn
  }, [])
  const captureFrontMannequin = useCallback<FrontCaptureFn>(async options => {
    if (!captureFrontRef.current) throw new Error('The 3D mannequin is still loading. Try again in a moment.')
    return captureFrontRef.current(options)
  }, [])

  const confirmGarmentRights = useCallback(
    (catalogId: string) => {
      const item = demoCatalog.items.find(i => i.id === catalogId)
      if (item) setRightsConfirmed(item, true)
    },
    [demoCatalog.items]
  )

  const closePicker = useCallback(() => setPickerOpen(false), [])
  const closeMeasure = useCallback(() => setMeasureOpen(false), [])
  const primaryThumb = primary ? thumbOf(primary) : null
  const tab = (on: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${on ? 'bg-brand text-white' : 'text-ink hover:bg-ink/5'}`
  // On phones only one view shows; the other stays rendered off-screen so the 3D capture still works.
  const mobileHidden = 'max-md:pointer-events-none max-md:absolute max-md:-left-[200vw] max-md:w-[calc(100vw-2rem)]'

  return (
    <div className='space-y-4'>
      <h1 className='text-2xl font-bold'>Fitting room</h1>

      {/* Selected outfit and its actions */}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-3'>
          {primary &&
            (primaryThumb ? (
              <img src={primaryThumb} alt='' className='h-14 w-11 shrink-0 rounded-lg border border-ink/10 object-cover' />
            ) : (
              <span className='h-14 w-11 shrink-0 rounded-lg border border-ink/10' style={{ backgroundColor: primary.color }} />
            ))}
          <div className='min-w-0'>
            <p className='text-xs font-medium uppercase tracking-wide text-muted'>Selected outfit</p>
            <p className='line-clamp-2 font-semibold' data-testid='outfit-name'>
              {outfitName}
            </p>
          </div>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button variant='secondary' onClick={openPicker}>
            Change outfit
          </Button>
          <Button onClick={() => void onSaveLook()} disabled={worn.length === 0}>
            Save look
          </Button>
        </div>
      </div>
      {message && (
        <p className='text-sm text-muted' role='status'>
          {message}{' '}
          {message.includes('Saved looks') && (
            <Link to='/outfits#saved-looks' className='font-medium text-brand underline'>
              Open Saved looks
            </Link>
          )}
        </p>
      )}

      {/* Phone: one view at a time */}
      <div className='grid grid-cols-2 rounded-lg border border-ink/15 p-0.5 md:hidden' role='tablist' aria-label='Preview'>
        <button type='button' role='tab' aria-selected={mobileView === '3d'} className={tab(mobileView === '3d')} onClick={() => setMobileView('3d')}>
          3D Preview
        </button>
        <button type='button' role='tab' aria-selected={mobileView === 'ai'} className={tab(mobileView === 'ai')} onClick={() => setMobileView('ai')}>
          AI Photo
        </button>
      </div>

      <div className='relative grid items-start gap-4 md:grid-cols-2'>
        <Card className={`space-y-3 ${mobileView === '3d' ? '' : mobileHidden}`} aria-labelledby='preview-3d-heading'>
          <div className='flex items-center justify-between gap-2'>
            <h2 id='preview-3d-heading' className='font-semibold'>
              3D Preview
            </h2>
            <Button variant='ghost' className='px-2 py-1 text-xs' onClick={() => setSpin(!spin)} aria-pressed={spin}>
              {spin ? 'Stop rotating' : 'Rotate'}
            </Button>
          </div>
          <Avatar3D
            profile={profile}
            worn={worn}
            autoRotate={spin}
            onAutoRotateChange={setSpin}
            onRegisterFrontCapture={handleRegisterFrontCapture}
            showProfileBadge={false}
            note={worn.length > 0 ? 'Approximate 3D Preview' : undefined}
          />
          <div className='flex flex-wrap items-center justify-between gap-2 text-sm'>
            <span className='text-muted'>
              <span className='font-medium text-ink'>{profile.height_cm} cm</span> ·{' '}
              <span className='capitalize'>{profile.fit_pref}</span> fit · {mannequinGender} mannequin
            </span>
            <Button variant='secondary' className='px-3 py-1.5' onClick={() => setMeasureOpen(true)}>
              Edit measurements
            </Button>
          </div>
        </Card>

        <Card className={mobileView === 'ai' ? '' : mobileHidden}>
          <AiTryOnPanel
            garments={worn}
            outfitName={outfitName}
            originOf={originOf}
            demoMeta={catalog.meta}
            onConfirmRights={confirmGarmentRights}
            onCaptureFrontMannequin={captureFrontMannequin}
            frameClassName={PREVIEW_FRAME_HEIGHT}
          />
        </Card>
      </div>

      <SidePanel
        open={pickerOpen}
        title='Change outfit'
        onClose={closePicker}
        width='md:w-[560px]'
        footer={
          <div className='flex items-center justify-between gap-2'>
            <span className='truncate text-sm text-muted'>{worn.length === 0 ? 'Nothing selected' : outfitName}</span>
            <Button onClick={closePicker}>Done</Button>
          </div>
        }
      >
        <GarmentPicker
          activeSource={pickerSource ?? 'catalog'}
          onSourceChange={setPickerSource}
          wornIds={wornIds}
          onToggle={toggle}
          thumbs={catalog.thumbs}
          sources={[
            {
              id: 'catalog',
              label: 'Catalog',
              items: catalog.forMannequin,
              loading: demoCatalog.state === 'loading',
              note: (
                <>
                  Showing unisex and {mannequinGender} clothes for the {mannequinGender} mannequin
                  {catalog.hiddenForGender > 0 && ` (${catalog.hiddenForGender} for the other mannequin hidden)`}. The
                  full collection is in the{' '}
                  <Link to='/catalog' className='font-medium text-brand underline'>
                    Catalog
                  </Link>
                  .
                </>
              ),
              empty: 'The catalog is not available on this build.',
            },
            {
              id: 'wardrobe',
              label: 'My Wardrobe',
              items: wardrobe.items,
              loading: wardrobe.loading,
              empty: (
                <>
                  Your wardrobe is empty.{' '}
                  <Link to='/' className='font-medium text-brand underline'>
                    Add your clothes
                  </Link>{' '}
                  or pick from the Catalog.
                </>
              ),
            },
          ]}
        />
      </SidePanel>

      <SidePanel open={measureOpen} title='Body measurements' onClose={closeMeasure}>
        <BodyMeasurementsEditor
          profile={profile}
          save={save}
          onSaved={p => {
            setProfile(p)
            setMeasureOpen(false)
            setMessage('Measurements saved. The mannequin now uses them.')
          }}
          onCancel={closeMeasure}
        />
      </SidePanel>
    </div>
  )
}
