import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { getReviews, subscribeReviews } from './catalogReview'
import type { CatalogFile, CatalogItem } from './catalogTypes'

export const DEMO_CATALOG_BASE = `${import.meta.env.BASE_URL}demo-catalog/`
const EXPECTED_SCHEMA = 'fitsync-demo-catalog/1'

export type CatalogLoadState = 'loading' | 'ready' | 'missing' | 'error'

const CATEGORY_LABEL: Record<string, string> = {
  top: 'Top',
  bottom: 'Bottom',
  outerwear: 'Outerwear',
  dress: 'Dress',
  shoes: 'Shoes',
  accessory: 'Accessory',
}

/**
 * Loads the local Demo Clothing Catalog (public/demo-catalog/catalog.json)
 * and overlays this browser's review decisions.
 */
export function useDemoCatalog() {
  const [file, setFile] = useState<CatalogFile | null>(null)
  const [state, setState] = useState<CatalogLoadState>('loading')
  const [error, setError] = useState('')
  const reviews = useSyncExternalStore(subscribeReviews, getReviews, getReviews)

  useEffect(() => {
    let cancelled = false
    fetch(`${DEMO_CATALOG_BASE}catalog.json`, { cache: 'no-cache' })
      .then(async res => {
        // A missing public file falls back to index.html (200, text/html) in Vite / SPA hosts.
        const type = res.headers.get('content-type') ?? ''
        if (res.status === 404 || !type.includes('json')) return null
        if (!res.ok) throw new Error(`Catalog request failed (HTTP ${res.status})`)
        const data = (await res.json()) as CatalogFile
        if (data?.schema !== EXPECTED_SCHEMA || !Array.isArray(data.items)) {
          throw new Error('catalog.json has an unexpected format. Rebuild it with scripts/build_demo_catalog.py.')
        }
        return data
      })
      .then(data => {
        if (cancelled) return
        if (data) {
          setFile(data)
          setState('ready')
        } else {
          setState('missing')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load the demo catalog.')
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const items: CatalogItem[] = useMemo(() => {
    if (!file) return []
    return file.items.map(raw => {
      const local = reviews[raw.id] ?? null
      const confirmedCategory = local?.category ?? raw.review.category
      const category = confirmedCategory ?? raw.suggested.category
      const name = local?.name?.trim() || raw.review.name?.trim() || raw.display_name?.trim() || ''
      return {
        ...raw,
        imageUrl: `${DEMO_CATALOG_BASE}${raw.image}`,
        thumbUrl: `${DEMO_CATALOG_BASE}${raw.thumb}`,
        local,
        category,
        categoryConfirmed: confirmedCategory !== null,
        displayName:
          name ||
          `${category ? CATEGORY_LABEL[category] : 'Uncategorized'} · ${raw.origin.label} #${raw.id.slice(0, 6)}`,
        sleeveLength: local
          ? local.sleeve_length
          : raw.review.sleeve_length !== undefined
            ? raw.review.sleeve_length
            : raw.suggested.sleeve_length,
        status: local?.status ?? raw.review.status,
        rightsConfirmed: local?.rights_confirmed ?? raw.review.rights_confirmed,
        gender: local?.gender ?? raw.review.gender ?? raw.suggested.gender ?? 'unisex',
        genderConfirmed: Boolean(local?.gender ?? raw.review.gender),
      }
    })
  }, [file, reviews])

  return { file, items, state, error }
}
