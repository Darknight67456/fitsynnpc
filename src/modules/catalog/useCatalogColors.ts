import { useEffect, useRef, useState } from 'react'
import { detectDominantColorFromUrl } from '../wardrobe/photoTools'
import type { CatalogItem } from './catalogTypes'

// Shared across mounts so each thumbnail is only analysed once per page load.
// Two-piece outfits also store "<id>:lower" for the trousers or skirt.
const colorCache = new Map<string, string>()
const TWO_PIECE_TYPES = new Set(['kurta_set', 'salwar_kameez', 'baju_kurung', 'kebaya', 'lehenga'])

/** Every cached color for these items, including the lower-piece colors. */
function cachedColors(items: CatalogItem[]): Record<string, string> {
  return Object.fromEntries(
    items.flatMap(i => [i.id, `${i.id}:lower`].filter(k => colorCache.has(k)).map(k => [k, colorCache.get(k)!]))
  )
}

/**
 * Reads the main color of each catalog thumbnail in the browser, so demo garments
 * show on the 3D mannequin in their real color instead of a placeholder grey.
 * Returns a map of catalog item id to hex color; items still loading are absent.
 */
export function useCatalogColors(items: CatalogItem[], priorityIds: string[] = []): Record<string, string> {
  const [colors, setColors] = useState<Record<string, string>>(() => cachedColors(items))
  // Read when a run starts; changing it later does not restart the run.
  const priorityRef = useRef(priorityIds)
  useEffect(() => {
    priorityRef.current = priorityIds
  }, [priorityIds])

  useEffect(() => {
    let cancelled = false
    // Garments already on the mannequin get their color first.
    const first = new Set(priorityRef.current)
    const pending = items
      .filter(i => !colorCache.has(i.id))
      .sort((a, b) => Number(first.has(b.id)) - Number(first.has(a.id)))
    if (pending.length === 0) {
      setColors(cachedColors(items))
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
              if (item.details && TWO_PIECE_TYPES.has(item.details.garment_type)) {
                // Tunic over a separate lower piece: read each from its own part of the photo.
                colorCache.set(
                  item.id,
                  await detectDominantColorFromUrl(item.thumbUrl, {
                    band: { from: 0.05, to: 0.5 },
                    preferColorful: true,
                    ignoreBackground: true,
                  })
                )
                colorCache.set(
                  `${item.id}:lower`,
                  await detectDominantColorFromUrl(item.thumbUrl, { band: { from: 0.62, to: 0.95 }, ignoreBackground: true })
                )
              } else {
                colorCache.set(item.id, await detectDominantColorFromUrl(item.thumbUrl))
              }
            } catch {
              // Leave it out: the garment keeps its placeholder color.
            }
          })
        )
        if (cancelled) return
        setColors(cachedColors(items))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [items])

  return colors
}
