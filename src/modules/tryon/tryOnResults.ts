import { useSyncExternalStore } from 'react'
import type { AiTryOnProgress, AiTryOnResponse } from './aiTryOnService'

/**
 * AI try-on photos per outfit, kept in memory for this visit.
 * A run writes to the key of the outfit it started with, so switching outfits
 * mid-run never attaches the finished photo to the wrong outfit.
 */
export type TryOnEntry =
  | { status: 'working'; stage: AiTryOnProgress | 'capturing'; step?: string }
  | { status: 'success'; result: AiTryOnResponse; layers: AiTryOnResponse[]; outfitName: string }
  | { status: 'error'; message: string }

const entries = new Map<string, TryOnEntry>()
const controllers = new Map<string, AbortController>()
const listeners = new Set<() => void>()

// Finished photos also go to sessionStorage (as small JPEGs) so a reload in this tab keeps them.
const STORE_KEY = 'fitsync.tryOnPhotos.v1'
const MAX_STORED = 6
type StoredPhoto = { key: string; outfitName: string; image: string; totalMs: number; savedAt: number }

function readStored(): StoredPhoto[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as StoredPhoto[]) : []
  } catch {
    return []
  }
}

for (const p of readStored()) {
  entries.set(p.key, {
    status: 'success',
    outfitName: p.outfitName,
    layers: [],
    result: {
      status: 'success',
      mode: 'edge_function',
      resultImageDataUrl: p.image,
      capturedMannequinDataUrl: '',
      garmentImageUrl: null,
      garmentName: p.outfitName,
      catvtonCategory: 'upper_body',
      maskingStrategy: 'auto',
      metrics: { preprocessingMs: 0, inferenceMs: p.totalMs, totalMs: p.totalMs, outputResolution: '768x1024' },
      backendIntegrationNote: '',
    },
  })
}

async function toJpeg(dataUrl: string): Promise<string> {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.fillStyle = '#edeae3'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.85)
}

async function persist(key: string, entry: Extract<TryOnEntry, { status: 'success' }>) {
  try {
    const photo: StoredPhoto = {
      key,
      outfitName: entry.outfitName,
      image: await toJpeg(entry.result.resultImageDataUrl),
      totalMs: entry.result.metrics.totalMs,
      savedAt: Date.now(),
    }
    let list = [photo, ...readStored().filter(p => p.key !== key)].slice(0, MAX_STORED)
    // Drop the oldest photos until it fits the browser's storage limit.
    while (list.length > 0) {
      try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify(list))
        return
      } catch {
        list = list.slice(0, -1)
      }
    }
  } catch {
    // Storage blocked or the image could not be converted: the photo stays for this page view only.
  }
}

function forget(key: string) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(readStored().filter(p => p.key !== key)))
  } catch {
    // Nothing stored to remove.
  }
}

/** Stable key for a set of garments, independent of the order they were put on. */
export function outfitKey(ids: string[]): string {
  return [...ids].sort().join('|')
}

export function setTryOnEntry(key: string, entry: TryOnEntry | null) {
  const before = entries.get(key)
  if (entry) entries.set(key, entry)
  else entries.delete(key)
  listeners.forEach(fn => fn())
  if (entry?.status === 'success') void persist(key, entry)
  // A cancelled re-run keeps nothing; drop a stored photo only when the entry is cleared.
  else if (!entry && before?.status === 'success') forget(key)
}

export function startTryOnRun(key: string): AbortController {
  controllers.get(key)?.abort()
  const controller = new AbortController()
  controllers.set(key, controller)
  return controller
}

export function finishTryOnRun(key: string, controller: AbortController) {
  if (controllers.get(key) === controller) controllers.delete(key)
}

export function cancelTryOnRun(key: string) {
  controllers.get(key)?.abort()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useTryOnEntry(key: string): TryOnEntry | undefined {
  return useSyncExternalStore(
    subscribe,
    () => entries.get(key),
    () => entries.get(key)
  )
}
