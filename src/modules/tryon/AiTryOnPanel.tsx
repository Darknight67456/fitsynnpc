import { useMemo, useState } from 'react'
import Button from '../../components/Button'
import type { ClothingItem } from '../../types'
import type { DemoGarmentMeta } from '../catalog/catalogTypes'
import type { FrontCaptureFn } from '../avatar/Avatar3D'
import type { GarmentOrigin } from '../fittingRoom/useFittingRoomItems'
import {
  AiTryOnCancelledError,
  generateAiTryOn,
  mapCategoryToCatVTON,
  TRYON_MODE,
  type AiTryOnProgress,
  type AiTryOnResponse,
} from './aiTryOnService'
import {
  cancelTryOnRun,
  finishTryOnRun,
  outfitKey,
  setTryOnEntry,
  startTryOnRun,
  useTryOnEntry,
} from './tryOnResults'

interface AiTryOnPanelProps {
  /** Garments currently on the 3D mannequin (the selected outfit). */
  garments: ClothingItem[]
  outfitName: string
  originOf: (item: ClothingItem) => GarmentOrigin
  demoMeta: Record<string, DemoGarmentMeta>
  /** Records that the team may use this catalog photo (by catalog id). */
  onConfirmRights: (catalogId: string) => void
  onCaptureFrontMannequin: FrontCaptureFn
  /** Height classes shared with the 3D preview so both views frame the outfit the same way. */
  frameClassName: string
}

const STAGE_TEXT: Record<AiTryOnProgress | 'capturing', string> = {
  capturing: 'Taking a front photo of your mannequin…',
  preparing: 'Preparing the garment photo…',
  queued: 'Waiting for a GPU. The first run after a quiet spell can take a few minutes.',
  running: 'Dressing the mannequin…',
}

/** Why a worn garment cannot go to CatVTON, or null when it can. */
function blockReason(item: ClothingItem, origin: GarmentOrigin): string | null {
  if (!mapCategoryToCatVTON(item.category)) return `${item.category} is not part of the AI photo`
  if (origin === 'sample' || !item.image_url) return 'no real photo'
  return null
}

/**
 * The order CatVTON dresses the mannequin, one garment per run: a dress or bottom first,
 * then the top, and outerwear last so it ends up on the outside.
 */
function layerOrder(items: ClothingItem[]): ClothingItem[] {
  const pick = (cat: ClothingItem['category']) => items.find(i => i.category === cat)
  const dress = pick('dress')
  const base = dress ? [dress] : [pick('bottom'), pick('top')]
  return [...base, pick('outerwear')].filter((i): i is ClothingItem => Boolean(i))
}

export default function AiTryOnPanel({
  garments,
  outfitName,
  originOf,
  demoMeta,
  onConfirmRights,
  onCaptureFrontMannequin,
  frameClassName,
}: AiTryOnPanelProps) {
  const [simulateError, setSimulateError] = useState(false)
  const isLive = TRYON_MODE === 'edge_function'

  const candidates = useMemo(
    () => garments.map(item => ({ item, origin: originOf(item), reason: blockReason(item, originOf(item)) })),
    [garments, originOf]
  )
  const layers = useMemo(() => layerOrder(candidates.filter(c => c.reason === null).map(c => c.item)), [candidates])
  const skipped = candidates.filter(c => c.reason !== null)
  const key = outfitKey(layers.map(l => l.id))
  const entry = useTryOnEntry(key)
  const working = entry?.status === 'working'

  // Catalog photos in this outfit whose usage rights still need a tick before a live run.
  const needsRights = isLive
    ? layers.filter(l => originOf(l) === 'demo_catalog' && !demoMeta[l.id]?.rightsConfirmed)
    : []

  async function generate() {
    if (layers.length === 0) return
    // Everything below is tied to the outfit as it was when Generate was pressed.
    const runKey = key
    const runLayers = layers
    const runName = outfitName
    // "Generate again" that gets cancelled brings the earlier photo back.
    const previous = entry?.status === 'success' ? entry : null
    const controller = startTryOnRun(runKey)
    setTryOnEntry(runKey, { status: 'working', stage: 'capturing' })

    try {
      const hideOuter = runLayers.length > 1 && runLayers[runLayers.length - 1].category === 'outerwear'
      const captured = await onCaptureFrontMannequin(hideOuter ? { hideCategories: ['outerwear'] } : undefined)
      let person = captured
      const results: AiTryOnResponse[] = []
      for (const [i, layer] of runLayers.entries()) {
        const category = mapCategoryToCatVTON(layer.category)
        if (!category) continue
        const meta = demoMeta[layer.id]
        const step = runLayers.length > 1 ? `Step ${i + 1} of ${runLayers.length} · ${layer.name}` : undefined
        const result = await generateAiTryOn(
          {
            personImageBase64: person,
            garmentItem: layer,
            catvtonCategory: category,
            maskingStrategy: 'auto',
            numInferenceSteps: 25,
            guidanceScale: 2.5,
            seed: 42,
            garmentSource: originOf(layer) === 'demo_catalog' ? 'demo_catalog' : 'wardrobe',
            garmentRightsConfirmed: meta ? meta.rightsConfirmed : true,
            sleeveLength: meta?.sleeveLength ?? 'auto',
          },
          {
            simulateError,
            signal: controller.signal,
            onProgress: stage => setTryOnEntry(runKey, { status: 'working', stage, step }),
          }
        )
        results.push(result)
        person = result.resultImageDataUrl
      }
      const last = results[results.length - 1]
      const combined: AiTryOnResponse = {
        ...last,
        capturedMannequinDataUrl: captured,
        garmentName: results.map(r => r.garmentName).join(' + '),
        metrics: { ...last.metrics, totalMs: results.reduce((sum, r) => sum + r.metrics.totalMs, 0) },
      }
      setTryOnEntry(runKey, { status: 'success', result: combined, layers: results, outfitName: runName })
    } catch (err) {
      if (err instanceof AiTryOnCancelledError) {
        setTryOnEntry(runKey, previous)
        return
      }
      setTryOnEntry(runKey, {
        status: 'error',
        message: err instanceof Error ? err.message : 'The AI photo did not finish. Try again.',
      })
    } finally {
      finishTryOnRun(runKey, controller)
    }
  }

  function confirmRights(itemId: string) {
    const meta = demoMeta[itemId]
    if (!meta) return
    onConfirmRights(meta.catalogId)
    if (entry?.status === 'error') setTryOnEntry(key, null)
  }

  const canGenerate = layers.length > 0 && !working && needsRights.length === 0

  return (
    <section className='flex flex-col gap-3' aria-labelledby='ai-photo-heading' data-testid='ai-tryon-panel'>
      <div className='flex items-center justify-between gap-2'>
        <h2 id='ai-photo-heading' className='font-semibold'>
          AI Try-On Photo
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            isLive ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
          }`}
        >
          {isLive ? 'Live GPU' : 'Preview mode (no GPU)'}
        </span>
      </div>

      <div
        className={`relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-ink/10 bg-[#edeae3] p-4 ${frameClassName}`}
        aria-live='polite'
        aria-busy={working}
      >
        {entry?.status === 'success' ? (
          <img
            src={entry.result.resultImageDataUrl}
            alt={`AI try-on photo of ${entry.outfitName}`}
            className='h-full w-full object-contain'
            data-testid='ai-tryon-result-img'
            data-outfit-key={key}
          />
        ) : working ? (
          <div className='flex max-w-xs flex-col items-center gap-3 text-center text-sm' role='status' data-testid='ai-tryon-loading'>
            <span className='h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent motion-reduce:animate-none' />
            {entry.step && <span className='font-medium'>{entry.step}</span>}
            <span className='text-muted'>{STAGE_TEXT[entry.stage]}</span>
          </div>
        ) : entry?.status === 'error' ? (
          <div className='flex max-w-xs flex-col items-center gap-3 text-center text-sm' role='alert' data-testid='ai-tryon-error'>
            <p className='text-red-800'>{entry.message}</p>
            <Button onClick={() => void generate()} disabled={!canGenerate}>
              Try again
            </Button>
          </div>
        ) : layers.length === 0 ? (
          <p className='max-w-xs text-center text-sm text-muted'>
            Choose a top, bottom, dress or outerwear with a photo to make an AI photo.
          </p>
        ) : (
          <div className='flex max-w-xs flex-col items-center gap-3 text-center text-sm'>
            <p className='text-muted'>
              No AI photo for this outfit yet. It turns the mannequin into a realistic picture wearing{' '}
              <span className='font-medium text-ink'>{outfitName}</span>.
            </p>
            <Button onClick={() => void generate()} disabled={!canGenerate} data-testid='generate-ai-tryon-btn'>
              Generate AI Photo
            </Button>
          </div>
        )}
      </div>

      {needsRights.map(item => (
        <label
          key={item.id}
          className='flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900'
        >
          <input
            type='checkbox'
            className='mt-0.5 h-4 w-4 shrink-0'
            checked={false}
            disabled={working}
            onChange={() => confirmRights(item.id)}
          />
          <span>
            The team has the right to use the photo of <span className='font-medium'>{item.name}</span> (owner consent,
            or our own photo or edit). It is sent to the GPU worker for this photo.
          </span>
        </label>
      ))}

      <div className='flex flex-wrap items-center gap-2'>
        {entry?.status === 'success' && (
          <>
            <Button variant='secondary' onClick={() => void generate()} disabled={!canGenerate}>
              Generate again
            </Button>
            <a
              href={entry.result.resultImageDataUrl}
              download={`fitsync-${entry.outfitName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`}
              className='rounded-lg border border-ink/20 px-4 py-2 text-sm font-semibold hover:bg-ink/5'
            >
              Download photo
            </a>
          </>
        )}
        {working && (
          <Button variant='secondary' onClick={() => cancelTryOnRun(key)}>
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

      <p className='text-xs text-muted'>
        {layers.length > 1
          ? `Dressed in ${layers.length} steps (${layers.map(l => l.name).join(', then ')}), one GPU run each.`
          : 'One GPU run.'}{' '}
        A visual preview only; it does not show how the garment fits or which size to buy.
        {skipped.length > 0 && ` Not in the photo: ${skipped.map(c => `${c.item.name} (${c.reason})`).join(', ')}.`}
        {entry?.status === 'success' && ` Took ${(entry.result.metrics.totalMs / 1000).toFixed(1)} s.`}
      </p>
    </section>
  )
}
