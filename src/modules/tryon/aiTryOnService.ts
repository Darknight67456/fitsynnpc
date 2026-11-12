import { supabase } from '../../lib/supabase'
import type { Category, ClothingItem } from '../../types'

/**
 * CatVTON cloth_type categories supported by the official AutoMasker / inference pipeline.
 */
export type CatVTONCategory = 'upper_body' | 'lower_body' | 'dresses'

/**
 * Masking strategy for CatVTON inference. 'auto' runs AutoMasker (DensePose + SCHP)
 * inside the RunPod worker, refined by the FitSync sleeve-aware mask.
 */
export type MaskingStrategy = 'auto' | 'provided'

export type AiTryOnExecutionMode = 'mock' | 'edge_function'

/**
 * Which backend the try-on uses. Stays 'mock' (no paid GPU) unless the build sets
 * VITE_TRYON_MODE=edge_function after the RunPod endpoint has been deployed and verified.
 */
export const TRYON_MODE: AiTryOnExecutionMode =
  import.meta.env.VITE_TRYON_MODE === 'edge_function' ? 'edge_function' : 'mock'

/** Progress reported while a try-on runs. */
export type AiTryOnProgress = 'preparing' | 'queued' | 'running'

export interface AiTryOnRequest {
  /** Front-view 3D mannequin canvas capture (data:image/png;base64,...) */
  personImageBase64: string
  /** Selected clothing item owned by the logged-in user */
  garmentItem: ClothingItem
  /** Mapped CatVTON category ('upper_body' | 'lower_body' | 'dresses') */
  catvtonCategory: CatVTONCategory
  /** Masking strategy ('auto' in Colab PoC; unresolved requirement in RunPod worker) */
  maskingStrategy?: MaskingStrategy
  /** Optional explicit agnostic mask (data:image/png;base64,...) */
  maskImageBase64?: string
  /** Diffusion denoising steps (default: 25) */
  numInferenceSteps?: number
  /** Classifier-free guidance scale (default: 2.5) */
  guidanceScale?: number
  /** Optional deterministic RNG seed */
  seed?: number
  /** Where the garment came from. Demo catalog items are local, non-production images. */
  garmentSource?: 'wardrobe' | 'demo_catalog'
  /** Demo catalog only: whether the team has confirmed the right to use this image */
  garmentRightsConfirmed?: boolean
  /** Sleeve-length hint for the worker's FitSync mask ('auto' = official AutoMasker mask) */
  sleeveLength?: 'auto' | 'short_sleeve' | 'long_sleeve' | 'sleeveless'
}

export interface AiTryOnResponse {
  status: 'success'
  mode: AiTryOnExecutionMode
  resultImageDataUrl: string
  capturedMannequinDataUrl: string
  garmentImageUrl: string | null
  garmentName: string
  catvtonCategory: CatVTONCategory
  maskingStrategy: MaskingStrategy
  metrics: {
    preprocessingMs: number
    inferenceMs: number
    totalMs: number
    outputResolution: string
  }
  backendIntegrationNote: string
}

/** Thrown when the user cancels a running try-on. */
export class AiTryOnCancelledError extends Error {
  constructor() {
    super('Try-on cancelled.')
    this.name = 'AiTryOnCancelledError'
  }
}

export interface AiTryOnOptions {
  mode?: AiTryOnExecutionMode
  simulateError?: boolean
  signal?: AbortSignal
  onProgress?: (stage: AiTryOnProgress) => void
}

const CANONICAL_WIDTH = 768
const CANONICAL_HEIGHT = 1024

/**
 * Maps FitSync wardrobe categories to official CatVTON cloth_type categories.
 * Returns null for categories not supported by CatVTON torso/leg try-on (e.g. shoes, accessories).
 */
export function mapCategoryToCatVTON(category: Category): CatVTONCategory | null {
  switch (category) {
    case 'top':
    case 'outerwear':
      return 'upper_body'
    case 'bottom':
      return 'lower_body'
    case 'dress':
      return 'dresses'
    default:
      return null
  }
}

/**
 * Loads an image URL or data URL into an HTMLImageElement with CORS support.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (!src.startsWith('data:')) {
      img.crossOrigin = 'anonymous'
    }
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image for AI Try-On preview.'))
    img.src = src
  })
}

/**
 * Turns the garment photo into a JPEG data URL (longest side at most 1024 px).
 * The GPU worker cannot reach localhost or private storage, so the image itself is sent,
 * not its URL. This is the real photo, not a placeholder.
 */
export async function garmentImageToDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:image/')) return src
  const img = await loadImage(src)
  const maxSide = 1024
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not prepare the garment image.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.92)
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AiTryOnCancelledError())
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new AiTryOnCancelledError())
      },
      { once: true }
    )
  })
}

/**
 * Generates a clearly labelled 768x1024 Mock AI Try-On composite image on an HTML5 canvas.
 * Preserves the captured front-view 3D mannequin, overlays the target garment & auto-mask zone,
 * and marks the output as a Phase 1 Mock Result (no paid GPU called).
 */
async function buildMockTryOnComposite(req: AiTryOnRequest): Promise<{
  compositeDataUrl: string
  normalizedMannequinDataUrl: string
}> {
  const mannequinImg = await loadImage(req.personImageBase64)

  const canvas = document.createElement('canvas')
  canvas.width = CANONICAL_WIDTH
  canvas.height = CANONICAL_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context for AI Try-On normalization.')
  }

  // 1. Fill studio background matching the 3D visualizer gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, CANONICAL_HEIGHT)
  bgGrad.addColorStop(0, '#f5f3ef')
  bgGrad.addColorStop(0.55, '#edeae3')
  bgGrad.addColorStop(1, '#e1dcd3')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, CANONICAL_WIDTH, CANONICAL_HEIGHT)

  // 2. Aspect-preserving center fit of the captured front-view mannequin canvas into 768x1024
  const scale = Math.min(
    CANONICAL_WIDTH / Math.max(1, mannequinImg.width),
    CANONICAL_HEIGHT / Math.max(1, mannequinImg.height)
  )
  const drawW = Math.round(mannequinImg.width * scale)
  const drawH = Math.round(mannequinImg.height * scale)
  const drawX = Math.round((CANONICAL_WIDTH - drawW) / 2)
  const drawY = Math.round((CANONICAL_HEIGHT - drawH) / 2)

  ctx.drawImage(mannequinImg, drawX, drawY, drawW, drawH)
  const normalizedMannequinDataUrl = canvas.toDataURL('image/png')

  // 3. Draw target AutoMasker region indicator (preserving faceless head above y = 0.24 * H)
  const zoneBounds: Record<
    CatVTONCategory,
    { topRatio: number; bottomRatio: number; widthRatio: number; label: string }
  > = {
    upper_body: {
      topRatio: 0.23,
      bottomRatio: 0.54,
      widthRatio: 0.44,
      label: 'CatVTON Auto-Mask Zone: upper_body (Head Excluded)',
    },
    lower_body: {
      topRatio: 0.48,
      bottomRatio: 0.86,
      widthRatio: 0.38,
      label: 'CatVTON Auto-Mask Zone: lower_body',
    },
    dresses: {
      topRatio: 0.23,
      bottomRatio: 0.80,
      widthRatio: 0.44,
      label: 'CatVTON Auto-Mask Zone: dresses (Head Excluded)',
    },
  }

  const zone = zoneBounds[req.catvtonCategory]
  const zoneW = Math.round(CANONICAL_WIDTH * zone.widthRatio)
  const zoneX = Math.round((CANONICAL_WIDTH - zoneW) / 2)
  const zoneY = Math.round(CANONICAL_HEIGHT * zone.topRatio)
  const zoneH = Math.round(CANONICAL_HEIGHT * (zone.bottomRatio - zone.topRatio))

  // Soft garment tint + dashed agnostic mask boundary
  ctx.save()
  ctx.strokeStyle = 'rgba(79, 70, 229, 0.65)'
  ctx.lineWidth = 2
  ctx.setLineDash([8, 6])
  ctx.strokeRect(zoneX, zoneY, zoneW, zoneH)
  ctx.restore()

  // 4. If the selected wardrobe item has an image_url, render a garment reference inset card
  if (req.garmentItem.image_url) {
    try {
      const garmentImg = await loadImage(req.garmentItem.image_url)

      // Overlay subtle garment preview inside the target zone
      ctx.save()
      ctx.globalAlpha = 0.26
      const gScale = Math.min(zoneW / garmentImg.width, zoneH / garmentImg.height) * 0.92
      const gw = garmentImg.width * gScale
      const gh = garmentImg.height * gScale
      ctx.drawImage(
        garmentImg,
        zoneX + (zoneW - gw) / 2,
        zoneY + (zoneH - gh) / 2,
        gw,
        gh
      )
      ctx.restore()

      // Draw crisp garment reference card in bottom-right corner
      const cardW = 168
      const cardH = 204
      const cardX = CANONICAL_WIDTH - cardW - 24
      const cardY = CANONICAL_HEIGHT - cardH - 24

      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.14)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(cardX, cardY, cardW, cardH, 12)
      ctx.fill()
      ctx.stroke()

      const thumbPad = 10
      const thumbSize = cardW - thumbPad * 2
      ctx.save()
      ctx.beginPath()
      ctx.roundRect(cardX + thumbPad, cardY + thumbPad, thumbSize, thumbSize, 8)
      ctx.clip()
      ctx.drawImage(garmentImg, cardX + thumbPad, cardY + thumbPad, thumbSize, thumbSize)
      ctx.restore()

      ctx.fillStyle = '#0f172a'
      ctx.font = '600 12px system-ui, -apple-system, sans-serif'
      ctx.fillText(
        req.garmentItem.name.slice(0, 20),
        cardX + thumbPad,
        cardY + thumbPad + thumbSize + 20
      )
      ctx.fillStyle = '#64748b'
      ctx.font = '500 11px system-ui, -apple-system, sans-serif'
      ctx.fillText(
        `Input: ${req.catvtonCategory}`,
        cardX + thumbPad,
        cardY + thumbPad + thumbSize + 36
      )
    } catch {
      // Fallback if external garment image blocks CORS canvas read
    }
  }

  // 5. Top Mock Mode Banner (Unmistakable Phase 1 indicator)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.86)'
  ctx.fillRect(0, 0, CANONICAL_WIDTH, 54)
  ctx.fillStyle = '#fbbf24'
  ctx.font = '700 14px system-ui, -apple-system, sans-serif'
  ctx.fillText('MOCK AI TRY-ON RESULT (PHASE 1 — NO PAID GPU CALLED)', 20, 24)
  ctx.fillStyle = '#e2e8f0'
  ctx.font = '400 12px system-ui, -apple-system, sans-serif'
  ctx.fillText(
    `Garment: ${req.garmentItem.name} · Category: ${req.catvtonCategory} · Masking: ${
      req.maskingStrategy ?? 'auto'
    } · 768×1024`,
    20,
    43
  )

  return {
    compositeDataUrl: canvas.toDataURL('image/png'),
    normalizedMannequinDataUrl,
  }
}

interface EdgeTryOnReply {
  status: 'success' | 'pending' | 'error'
  job_id?: string
  runpod_status?: string
  message?: string
  image_base64?: string
  metrics?: {
    preprocessing_ms?: number
    inference_ms?: number
    total_ms?: number
    output_resolution?: string
  }
}

async function callEdge(body: Record<string, unknown>): Promise<EdgeTryOnReply> {
  const { data, error } = await supabase.functions.invoke('catvton-tryon', { body })
  if (error) {
    throw new Error(`The try-on service could not be reached (${error.message}). Check your connection and try again.`)
  }
  const reply = data as EdgeTryOnReply | null
  if (!reply || reply.status === 'error') {
    throw new Error(reply?.message || 'The try-on service returned an error. Try again in a moment.')
  }
  return reply
}

/**
 * Live path: Supabase Edge Function `catvton-tryon` proxies to the RunPod worker.
 * The RunPod key stays in Supabase secrets; the browser only sends its Supabase session.
 * A cold GPU can take minutes, so the function returns a job id and the browser polls it.
 */
async function invokeSupabaseEdgeTryOn(
  req: AiTryOnRequest,
  options: AiTryOnOptions
): Promise<AiTryOnResponse> {
  const { signal, onProgress } = options
  const startMs = performance.now()
  if (!req.garmentItem.image_url) {
    throw new Error('This garment has no photo, so it cannot be sent to AI try-on.')
  }

  onProgress?.('preparing')
  const garmentImage = await garmentImageToDataUrl(req.garmentItem.image_url)
  if (signal?.aborted) throw new AiTryOnCancelledError()

  let reply = await callEdge({
    person_image: req.personImageBase64,
    garment_image: garmentImage,
    garment_id: req.garmentItem.id,
    garment_source: req.garmentSource ?? 'wardrobe',
    category: req.catvtonCategory,
    masking_strategy: req.maskingStrategy ?? 'auto',
    mask_image: req.maskImageBase64 ?? null,
    num_inference_steps: req.numInferenceSteps ?? 25,
    guidance_scale: req.guidanceScale ?? 2.5,
    seed: req.seed ?? 42,
    sleeve_length: req.sleeveLength ?? 'auto',
  })

  // Poll for up to ~6 minutes: the first call after a cold start includes the model download.
  const deadline = Date.now() + 6 * 60 * 1000
  while (reply.status === 'pending') {
    onProgress?.(reply.runpod_status === 'IN_PROGRESS' ? 'running' : 'queued')
    if (Date.now() > deadline) {
      throw new Error('The GPU worker is taking too long. It may still be starting up; try again in a minute.')
    }
    await wait(3000, signal)
    reply = await callEdge({ job_id: reply.job_id })
  }

  if (!reply.image_base64) {
    throw new Error('The try-on finished without an image. Try again, or pick a different garment photo.')
  }

  const totalMs = Math.round(performance.now() - startMs)
  return {
    status: 'success',
    mode: 'edge_function',
    resultImageDataUrl: reply.image_base64,
    capturedMannequinDataUrl: req.personImageBase64,
    garmentImageUrl: req.garmentItem.image_url,
    garmentName: req.garmentItem.name,
    catvtonCategory: req.catvtonCategory,
    maskingStrategy: req.maskingStrategy ?? 'auto',
    metrics: {
      preprocessingMs: reply.metrics?.preprocessing_ms ?? 0,
      inferenceMs: reply.metrics?.inference_ms ?? totalMs,
      totalMs,
      outputResolution: reply.metrics?.output_resolution ?? '768x1024',
    },
    backendIntegrationNote:
      'Generated by CatVTON on a RunPod GPU through the catvton-tryon Supabase Edge Function. This is a visual preview only; it does not show how the garment fits or which size to buy.',
  }
}

/**
 * Main AI Virtual Try-On service entry point.
 * Defaults to 'mock' mode in Phase 1 so no paid GPU resources are called.
 */
export async function generateAiTryOn(
  req: AiTryOnRequest,
  options: AiTryOnOptions = {}
): Promise<AiTryOnResponse> {
  const mode = options.mode ?? TRYON_MODE

  if (!req.personImageBase64 || !req.personImageBase64.startsWith('data:image/')) {
    throw new Error('Invalid front-view mannequin capture. Please try capturing again.')
  }

  if (!req.garmentItem) {
    throw new Error('Please select a clothing item from your wardrobe first.')
  }

  if (mode === 'edge_function' && req.garmentSource === 'demo_catalog' && !req.garmentRightsConfirmed) {
    throw new Error(
      'This demo catalog image has no confirmed usage rights yet. Approve it in the Demo Catalog review before sending it to the live GPU worker.'
    )
  }

  if (options.simulateError) {
    await new Promise(resolve => setTimeout(resolve, 600))
    throw new Error('Simulated error: the GPU worker did not respond. Use Retry to run it again.')
  }

  if (mode === 'edge_function') {
    return invokeSupabaseEdgeTryOn(req, options)
  }

  // Phase 1 Mock Workflow: simulate realistic preprocessing + diffusion latency without calling paid GPUs
  const t0 = performance.now()
  const { compositeDataUrl, normalizedMannequinDataUrl } = await buildMockTryOnComposite(req)
  const preprocessElapsed = Math.round(performance.now() - t0)

  const simulatedDiffusionMs = 950
  options.onProgress?.('running')
  await wait(simulatedDiffusionMs, options.signal)
  const totalMs = Math.round(performance.now() - t0)

  return {
    status: 'success',
    mode: 'mock',
    resultImageDataUrl: compositeDataUrl,
    capturedMannequinDataUrl: normalizedMannequinDataUrl,
    garmentImageUrl: req.garmentItem.image_url,
    garmentName: req.garmentItem.name,
    catvtonCategory: req.catvtonCategory,
    maskingStrategy: req.maskingStrategy ?? 'auto',
    metrics: {
      preprocessingMs: Math.max(45, preprocessElapsed),
      inferenceMs: simulatedDiffusionMs,
      totalMs,
      outputResolution: `${CANONICAL_WIDTH}x${CANONICAL_HEIGHT}`,
    },
    backendIntegrationNote:
      'Mock preview made in your browser: the garment photo is laid over the mannequin to show the request. No GPU was called and this is not an AI result.',
  }
}

