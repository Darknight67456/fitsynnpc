import type { Category } from '../../types'

/**
 * Demo Clothing Catalog types.
 *
 * The catalog is a LOCAL, read-only demo dataset built by
 * scripts/build_demo_catalog.py into public/demo-catalog/ (git-ignored).
 * It is never written to the Supabase `clothing_items` table, so it cannot
 * mix with a user's private wardrobe or bypass wardrobe RLS.
 */

export type SleeveLength = 'short_sleeve' | 'long_sleeve' | 'sleeveless'
export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export type CatalogSourceGroup =
  | 'edited_clothing'
  | 'team_photos_part_1'
  | 'team_photos_part_2'
  | 'catalog_references'

export interface CatalogItemRaw {
  id: string
  image: string
  thumb: string
  width: number
  height: number
  bytes: number
  thumb_width: number
  thumb_height: number
  source_group: CatalogSourceGroup
  role: string
  origin: { label: string; detail: string }
  source_path: string
  original_sha256: string
  suggested: {
    category: Category | null
    sleeve_length: SleeveLength | null
    note: string | null
    by: string
  }
  review: {
    status: ReviewStatus
    category: Category | null
    name: string | null
    rights_confirmed: boolean
    /** Team-confirmed sleeve length (scripts/demo_catalog_selection.json) */
    sleeve_length?: SleeveLength | null
  }
  flags: string[]
}

export interface CatalogFile {
  schema: string
  generated_at: string
  source_manifest: {
    dataset: string | null
    version: string | null
    notes: string | null
    item_count: number
  }
  policy: { production_import: string; storage: string }
  items: CatalogItemRaw[]
  excluded: { id: string; source_path: string; reason: string }[]
}

/** A reviewer's decision, kept in this browser only until it is exported and approved. */
export interface LocalReview {
  status: ReviewStatus
  category: Category | null
  name: string
  sleeve_length: SleeveLength | null
  rights_confirmed: boolean
  reviewed_at: string
}

/** Catalog item merged with any local review: what the UI actually shows. */
export interface CatalogItem extends CatalogItemRaw {
  imageUrl: string
  thumbUrl: string
  local: LocalReview | null
  category: Category | null
  categoryConfirmed: boolean
  displayName: string
  sleeveLength: SleeveLength | null
  status: ReviewStatus
  rightsConfirmed: boolean
}

/** Extra info the AI Try-On panel needs about a demo garment. */
export interface DemoGarmentMeta {
  catalogId: string
  originLabel: string
  categoryConfirmed: boolean
  rightsConfirmed: boolean
  sleeveLength: SleeveLength | null
}
