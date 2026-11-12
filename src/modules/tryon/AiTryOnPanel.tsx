import { useEffect, useMemo, useRef, useState } from 'react'
import Card from '../../components/Card'
import Button from '../../components/Button'
import type { ClothingItem } from '../../types'
import type { DemoGarmentMeta } from '../catalog/catalogTypes'
import {
  AiTryOnCancelledError,
  generateAiTryOn,
  mapCategoryToCatVTON,
  TRYON_MODE,
  type AiTryOnProgress,
  type AiTryOnResponse,
} from './aiTryOnService'

export type GarmentOrigin = 'wardrobe' | 'demo_catalog' | 'sample'

interface AiTryOnPanelProps {
  /** Garments currently on the 3D mannequin. */
  garments: ClothingItem[]
  originOf: (item: ClothingItem) => GarmentOrigin
  demoMeta: Record<string, DemoGarmentMeta>
  onCaptureFrontMannequin: () => Promise<string>
  /** Bumped by the "AI try-on" button under the mannequin to start a run. */
  triggerSeq?: number
}

type RunState =
  | { kind: 'idle' }
  | { kind: 'working'; stage: AiTryOnProgress | 'capturing' }
  | { kind: 'success'; result: AiTryOnResponse }
  | { kind: 'error'; message: string }

const STAGE_TEXT: Record<AiTryOnProgress | 'capturing', string> = {
  capturing: 'Taking a front photo of your mannequin…',
  preparing: 'Preparing the garment photo…',
  queued: 'Waiting for a GPU. The first run after a quiet spell can take a few minutes.',
  running: 'Dressing the mannequin…',
}

/** Why a worn garment cannot go to CatVTON, or null when it can. */
function blockReason(item: ClothingItem, origin: GarmentOrigin): string | null {
  if (!mapCategoryToCatVTON(item.category)) return `${item.category} is not supported by CatVTON`
  if (origin === 'sample' || !item.image_url) return 'sample clothes have no real photo'
  return null
}

export default function AiTryOnPanel({
  garments,
  originOf,
  demoMeta,
  onCaptureFrontMannequin,
  triggerSeq = 0,
}: AiTryOnPanelProps) {
  const candidates = useMemo(
    () => garments.map(item => ({ item, origin: originOf(item), reason: blockReason(item, originOf(item)) })),
    [garments, originOf]
  )
  const eligible = candidates.filter(c => c.reason === null)

  const [chosenId, setChosenId] = useState<string | null>(null)
  const chosen = eligible.find(c => c.item.id === chosenId) ?? eligible[0] ?? null
  const [run, setRun] = useState<RunState>({ kind: 'idle' })
  const [simulateError, setSimulateError] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const isLive = TRYON_MODE === 'edge_function'

  useEffect(() => () => abortRef.current?.abort(), [])

  async function start() {
    if (!chosen) {
      setRun({ kind: 'error', message: 'Put a top, bottom, dress or outerwear with a photo on the mannequin first.' })
      return
    }
    const category = mapCategoryToCatVTON(chosen.item.category)
    if (!category) return
    const meta = demoMeta[chosen.item.id]

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRun({ kind: 'working', stage: 'capturing' })

    try {
      const person = await onCaptureFrontMannequin()
      const result = await generateAiTryOn(
        {
          personImageBase64: person,
          garmentItem: chosen.item,
          catvtonCategory: category,
          maskingStrategy: 'auto',
          numInferenceSteps: 25,
          guidanceScale: 2.5,
          seed: 42,
          garmentSource: chosen.origin === 'demo_catalog' ? 'demo_catalog' : 'wardrobe',
          garmentRightsConfirmed: meta ? meta.rightsConfirmed : true,
          sleeveLength: meta?.sleeveLength ?? 'auto',
        },
        {
          simulateError,
          signal: controller.signal,
          onProgress: stage => setRun({ kind: 'working', stage }),
        }
      )
      setRun({ kind: 'success', result })
    } catch (err) {
      if (err instanceof AiTryOnCancelledError) {
        setRun({ kind: 'idle' })
        return
      }
      setRun({
        kind: 'error',
        message: err instanceof Error ? err.message : 'The try-on did not finish. Try again.',
      })
    }
  }

  // "AI try-on" button under the mannequin.
  useEffect(() => {
    // A parent button asks for a run; starting it here is the intended side effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (triggerSeq > 0) void start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerSeq])

  const working = run.kind === 'working'
  const blocked = candidates.filter(c => c.reason !== null)
  const chosenMeta = chosen ? demoMeta[chosen.item.id] : undefined

  return (
    <Card className='space-y-4' data-testid='ai-tryon-panel'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div>
          <h2 className='font-semibold'>AI try-on photo</h2>
          <p className='text-sm text-muted'>
            Turns the mannequin into a realistic 2D picture wearing one chosen garment.
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            isLive ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'
          }`}
          title={isLive ? 'Uses CatVTON on a RunPod GPU' : 'No GPU is called in this build'}
        >
          {isLive ? 'Live GPU' : 'Preview mode'}
        </span>
      </div>

      {/* Garment choice */}
      {eligible.length === 0 ? (
        <p className='rounded-lg border border-dashed border-ink/20 p-3 text-sm text-muted'>
          Wear a top, bottom, dress or outerwear from <span className='font-medium text-ink'>My wardrobe</span> or the{' '}
          <span className='font-medium text-ink'>Catalog</span> to make a try-on photo.
        </p>
      ) : (
        <div>
          <p className='mb-1.5 text-sm font-medium'>Garment to render</p>
          <div className='flex flex-wrap gap-2' role='radiogroup' aria-label='Garment to render'>
            {eligible.map(({ item }) => {
              const on = chosen?.item.id === item.id
              return (
                <button
                  key={item.id}
                  type='button'
                  role='radio'
                  aria-checked={on}
                  disabled={working}
                  onClick={() => setChosenId(item.id)}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition ${
                    on ? 'border-brand bg-brand/5 ring-2 ring-brand/25' : 'border-ink/15 hover:border-ink/35'
                  }`}
                >
                  {item.image_url && <img src={item.image_url} alt='' className='h-9 w-9 rounded object-cover' />}
                  <span className='max-w-36 truncate font-medium'>{item.name}</span>
                </button>
              )
            })}
          </div>
          {eligible.length > 1 && (
            <p className='mt-1.5 text-xs text-muted'>
              CatVTON dresses one garment per photo. Generate once for each piece you want to see.
            </p>
          )}
          {chosenMeta && !chosenMeta.rightsConfirmed && isLive && (
            <p className='mt-1.5 text-xs text-amber-800'>
              This catalog photo's usage rights are not confirmed yet. Confirm them in the Catalog review before a live run.
            </p>
          )}
        </div>
      )}
      {blocked.length > 0 && (
        <p className='text-xs text-muted'>
          Skipped: {blocked.map(c => `${c.item.name} (${c.reason})`).join(', ')}.
        </p>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <Button onClick={() => void start()} disabled={working || !chosen} data-testid='generate-ai-tryon-btn'>
          {working ? 'Generating…' : run.kind === 'success' ? 'Generate again' : 'Generate try-on photo'}
        </Button>
        {working && (
          <Button variant='secondary' onClick={() => abortRef.current?.abort()}>
            Cancel
          </Button>
        )}
        {import.meta.env.DEV && (
          <label className='flex items-center gap-1.5 text-xs text-muted'>
            <input type='checkbox' checked={simulateError} onChange={e => setSimulateError(e.target.checked)} />
            Simulate an error (dev only)
          </label>
        )}
      </div>

      <div aria-live='polite'>
        {run.kind === 'working' && (
          <div className='flex items-center gap-3 rounded-lg bg-brand/5 p-3 text-sm' role='status' data-testid='ai-tryon-loading'>
            <span className='h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent motion-reduce:animate-none' />
            {STAGE_TEXT[run.stage]}
          </div>
        )}

        {run.kind === 'error' && (
          <div className='flex flex-wrap items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900' role='alert' data-testid='ai-tryon-error'>
            <p>{run.message}</p>
            <Button variant='secondary' onClick={() => void start()}>
              Retry
            </Button>
          </div>
        )}

        {run.kind === 'success' && (
          <div className='space-y-3' data-testid='ai-tryon-success'>
            <div className='grid grid-cols-3 gap-2'>
              <figure>
                <img
                  src={run.result.capturedMannequinDataUrl}
                  alt='Front view of your mannequin'
                  className='aspect-[3/4] w-full rounded-lg bg-[#edeae3] object-contain'
                  data-testid='ai-tryon-captured-img'
                />
                <figcaption className='mt-1 text-center text-xs text-muted'>Your mannequin</figcaption>
              </figure>
              <figure>
                {run.result.garmentImageUrl && (
                  <img
                    src={run.result.garmentImageUrl}
                    alt={run.result.garmentName}
                    className='aspect-[3/4] w-full rounded-lg bg-white object-contain'
                  />
                )}
                <figcaption className='mt-1 truncate text-center text-xs text-muted'>{run.result.garmentName}</figcaption>
              </figure>
              <figure>
                <img
                  src={run.result.resultImageDataUrl}
                  alt={`${run.result.mode === 'mock' ? 'Preview' : 'AI try-on'} of ${run.result.garmentName}`}
                  className='aspect-[3/4] w-full rounded-lg border-2 border-brand/40 bg-[#edeae3] object-contain'
                  data-testid='ai-tryon-result-img'
                />
                <figcaption className='mt-1 text-center text-xs font-medium text-brand'>
                  {run.result.mode === 'mock' ? 'Preview (not AI)' : 'AI result'}
                </figcaption>
              </figure>
            </div>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <p className='text-xs text-muted'>
                {run.result.backendIntegrationNote} {(run.result.metrics.totalMs / 1000).toFixed(1)} s.
              </p>
              <a
                href={run.result.resultImageDataUrl}
                download={`fitsync-tryon-${run.result.garmentName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`}
                className='rounded-lg border border-ink/20 px-3 py-1.5 text-sm font-semibold hover:bg-ink/5'
              >
                Download photo
              </a>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
