import { useEffect, useState } from 'react'
import { detectDominantColorFromUrl } from '../wardrobe/photoTools'
import type { CatalogItem } from './catalogTypes'

// Shared across mounts so each thumbnail is only analysed once per page load.
const colorCache = new Map<string, string>()

/**
 * Reads the main color of each catalog thumbnail in the browser, so demo garments
 * show on the 3D mannequin in their real color instead of a placeholder grey.
 * Returns a map of catalog item id to hex color; items still loading are absent.
 */
export function useCatalogColors(items: CatalogItem[]): Record<string, string> {
  const [colors, setColors] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.flatMap(i => (colorCache.has(i.id) ? [[i.id, colorCache.get(i.id)!]] : [])))
  )

  useEffect(() => {
    let cancelled = false
    const pending = items.filter(i => !colorCache.has(i.id))
    if (pending.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setColors(Object.fromEntries(items.map(i => [i.id, colorCache.get(i.id)!])))
      return
    }

    void (async () => {
      // A few at a time keeps the page responsive while ~100 thumbnails are read.
      const batchSize = 8
      for (let start = 0; start < pending.length && !cancelled; start += batchSize) {
        const batch = pending.slice(start, start + batchSize)
        await Promise.all(
          batch.map(async item => {
            try {
              colorCache.set(item.id, await detectDominantColorFromUrl(item.thumbUrl))
            } catch {
              // Leave it out: the garment keeps its placeholder color.
            }
          })
        )
        if (cancelled) return
        setColors(
          Object.fromEntries(items.flatMap(i => (colorCache.has(i.id) ? [[i.id, colorCache.get(i.id)!]] : [])))
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [items])

  return colors
}
