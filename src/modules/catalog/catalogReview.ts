import type { Category } from '../../types'
import type { CatalogItem, LocalReview, ReviewStatus, SleeveLength } from './catalogTypes'

/**
 * Review decisions for the Demo Catalog.
 *
 * Stored in this browser's localStorage only. This is a staging area for the
 * team to fix categories, names and rights before anything is approved for a
 * real import. Use "Export review" to share decisions; nothing here touches
 * Supabase.
 */

const STORAGE_KEY = 'fitsync.demoCatalog.review.v1'

export type ReviewMap = Record<string, LocalReview>

const CATEGORIES: Category[] = ['top', 'bottom', 'outerwear', 'dress', 'shoes', 'accessory']
const STATUSES: ReviewStatus[] = ['pending', 'approved', 'rejected']
const SLEEVES: SleeveLength[] = ['short_sleeve', 'long_sleeve', 'sleeveless']

let cache: ReviewMap | null = null
const listeners = new Set<() => void>()

function readStorage(): ReviewMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return sanitizeReviews(JSON.parse(raw)).reviews
  } catch {
    return {}
  }
}

function write(next: ReviewMap) {
  cache = next
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked (private mode etc.): keep decisions in memory for this tab.
  }
  listeners.forEach(fn => fn())
}

export function getReviews(): ReviewMap {
  if (cache === null) cache = readStorage()
  return cache
}

export function subscribeReviews(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function saveReview(id: string, review: Omit<LocalReview, 'reviewed_at'>) {
  write({ ...getReviews(), [id]: { ...review, reviewed_at: new Date().toISOString() } })
}

/** Sets only the usage-rights decision, keeping the item's other review values as they are shown now. */
export function setRightsConfirmed(item: CatalogItem, confirmed: boolean) {
  saveReview(item.id, {
    status: item.status,
    category: item.local?.category ?? item.review.category,
    name: item.local?.name ?? item.review.name ?? '',
    sleeve_length: item.local ? item.local.sleeve_length : item.sleeveLength,
    rights_confirmed: confirmed,
  })
}

export function clearReview(id: string) {
  const next = { ...getReviews() }
  delete next[id]
  write(next)
}

/** Keeps only well-formed review entries; ignores anything unexpected. */
export function sanitizeReviews(input: unknown): { reviews: ReviewMap; skipped: number } {
  const reviews: ReviewMap = {}
  let skipped = 0
  const source =
    input && typeof input === 'object' && 'reviews' in (input as Record<string, unknown>)
      ? (input as { reviews: unknown }).reviews
      : input
  if (!source || typeof source !== 'object') return { reviews, skipped }

  for (const [id, value] of Object.entries(source as Record<string, unknown>)) {
    const v = value as Partial<LocalReview> | null
    const ok =
      /^[0-9a-f]{8,64}$/.test(id) &&
      !!v &&
      typeof v === 'object' &&
      STATUSES.includes(v.status as ReviewStatus) &&
      (v.category === null || CATEGORIES.includes(v.category as Category)) &&
      (v.sleeve_length === null || SLEEVES.includes(v.sleeve_length as SleeveLength)) &&
      typeof v.rights_confirmed === 'boolean'
    if (!ok) {
      skipped++
      continue
    }
    reviews[id] = {
      status: v.status as ReviewStatus,
      category: (v.category ?? null) as Category | null,
      name: typeof v.name === 'string' ? v.name.slice(0, 80) : '',
      sleeve_length: (v.sleeve_length ?? null) as SleeveLength | null,
      rights_confirmed: v.rights_confirmed as boolean,
      reviewed_at: typeof v.reviewed_at === 'string' ? v.reviewed_at : new Date().toISOString(),
    }
  }
  return { reviews, skipped }
}

/** Merges imported decisions over the current ones. Returns counts for the UI. */
export function importReviews(input: unknown): { imported: number; skipped: number } {
  const { reviews, skipped } = sanitizeReviews(input)
  write({ ...getReviews(), ...reviews })
  return { imported: Object.keys(reviews).length, skipped }
}

export function buildReviewExport(meta: { dataset: string | null; version: string | null }) {
  return {
    schema: 'fitsync-demo-catalog-review/1',
    exported_at: new Date().toISOString(),
    dataset: meta.dataset,
    dataset_version: meta.version,
    note: 'Review decisions only. Import to production requires team approval.',
    reviews: getReviews(),
  }
}
