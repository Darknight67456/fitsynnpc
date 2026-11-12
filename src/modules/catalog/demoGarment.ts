import type { ClothingItem } from '../../types'
import { mapCategoryToCatVTON } from '../tryon/aiTryOnService'
import type { CatalogItem, DemoGarmentMeta } from './catalogTypes'

/** Fake owner id so demo garments can never be confused with a real user's rows. */
export const DEMO_CATALOG_USER_ID = 'demo-catalog'
export const DEMO_ITEM_PREFIX = 'demo-catalog:'

/** Why a catalog item cannot be sent to AI Try-On, or null when it can. */
export function tryOnBlockReason(item: CatalogItem): string | null {
  if (item.status === 'rejected') return 'Rejected in review'
  if (!item.category) return 'Set a category first'
  if (mapCategoryToCatVTON(item.category) === null) {
    return `${item.category} is not supported by CatVTON`
  }
  return null
}

export function demoTryOnId(item: CatalogItem): string {
  return `${DEMO_ITEM_PREFIX}${item.id}`
}

/**
 * Converts a catalog item into the ClothingItem shape the AI Try-On panel
 * already understands. This object lives in memory only; it is never saved.
 */
export function toTryOnClothingItem(item: CatalogItem, color?: string): ClothingItem {
  const absoluteImage =
    typeof window !== 'undefined' ? new URL(item.imageUrl, window.location.origin).href : item.imageUrl
  return {
    id: demoTryOnId(item),
    user_id: DEMO_CATALOG_USER_ID,
    name: item.displayName,
    image_url: absoluteImage,
    category: item.category ?? 'top',
    color: color ?? '#9ca3af',
    pattern: 'unknown',
    fabric: null,
    season: 'all',
    formality: 3,
    formality_levels: null,
    // The sleeve tag lets the 3D mannequin pick a short- or long-sleeve garment shape.
    tags: ['demo-catalog', item.source_group, ...(item.sleeveLength ? [sleeveTag(item.sleeveLength)] : [])],
    wear_count: 0,
    last_worn_at: null,
  }
}

function sleeveTag(sleeve: NonNullable<CatalogItem['sleeveLength']>): string {
  if (sleeve === 'long_sleeve') return 'long-sleeve'
  if (sleeve === 'sleeveless') return 'sleeveless'
  return 'short-sleeve'
}

export function toDemoMeta(item: CatalogItem): DemoGarmentMeta {
  return {
    catalogId: item.id,
    originLabel: item.origin.label,
    categoryConfirmed: item.categoryConfirmed,
    rightsConfirmed: item.rightsConfirmed,
    sleeveLength: item.sleeveLength,
  }
}
