import { useCallback, useMemo } from 'react'
import type { ClothingItem } from '../../types'
import { seedItems } from '../../data/seed'
import { useWardrobe } from '../wardrobe/useWardrobe'
import { useDemoCatalog } from '../catalog/useDemoCatalog'
import { useCatalogColors } from '../catalog/useCatalogColors'
import { DEMO_ITEM_PREFIX, toDemoMeta, toTryOnClothingItem } from '../catalog/demoGarment'
import type { DemoGarmentMeta } from '../catalog/catalogTypes'
import { useSelectedMannequinGender } from '../avatar/mannequinGenderStore'

export type GarmentOrigin = 'wardrobe' | 'demo_catalog' | 'sample'

/**
 * Every garment the fitting room can show: the user's wardrobe, the team catalog,
 * and (only to resolve old saved looks) the sample placeholders, which are no longer offered.
 */
export function useFittingRoomItems(priorityGarmentIds: string[] = []) {
  const wardrobe = useWardrobe()
  const demoCatalog = useDemoCatalog()
  const catalogColors = useCatalogColors(
    demoCatalog.items,
    priorityGarmentIds.filter(id => id.startsWith(DEMO_ITEM_PREFIX)).map(id => id.slice(DEMO_ITEM_PREFIX.length))
  )
  const mannequinGender = useSelectedMannequinGender()

  const catalog = useMemo(() => {
    const garments: ClothingItem[] = []
    // Picker shows only unisex garments and those cut for the current mannequin.
    const forMannequin: ClothingItem[] = []
    const thumbs = new Map<string, string>()
    const meta: Record<string, DemoGarmentMeta> = {}
    for (const item of demoCatalog.items) {
      if (item.status === 'rejected' || !item.category) continue
      const garment = toTryOnClothingItem(item, catalogColors[item.id], catalogColors[`${item.id}:lower`])
      garments.push(garment)
      if (item.gender === 'unisex' || item.gender === mannequinGender) forMannequin.push(garment)
      thumbs.set(garment.id, item.thumbUrl)
      meta[garment.id] = toDemoMeta(item)
    }
    return { garments, forMannequin, hiddenForGender: garments.length - forMannequin.length, thumbs, meta }
  }, [demoCatalog.items, catalogColors, mannequinGender])

  const ownedIds = useMemo(() => new Set(wardrobe.items.map(i => i.id)), [wardrobe.items])
  const originOf = useCallback(
    (item: ClothingItem): GarmentOrigin =>
      ownedIds.has(item.id) ? 'wardrobe' : item.id.startsWith(DEMO_ITEM_PREFIX) ? 'demo_catalog' : 'sample',
    [ownedIds]
  )

  const byId = useMemo(() => {
    const map = new Map<string, ClothingItem>()
    for (const s of seedItems) map.set(s.id, s)
    for (const g of catalog.garments) map.set(g.id, g)
    for (const i of wardrobe.items) map.set(i.id, i)
    return map
  }, [wardrobe.items, catalog.garments])

  const thumbOf = useCallback(
    (item: ClothingItem) => catalog.thumbs.get(item.id) ?? item.image_url,
    [catalog.thumbs]
  )

  return {
    wardrobe,
    demoCatalog,
    catalog,
    mannequinGender,
    originOf,
    byId,
    thumbOf,
    /** True once both sources have answered, so ids in a URL or saved look can be resolved. */
    ready: !wardrobe.loading && demoCatalog.state !== 'loading',
  }
}
