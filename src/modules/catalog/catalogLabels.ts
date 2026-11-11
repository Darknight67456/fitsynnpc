import type { Category } from '../../types'
import type { CatalogSourceGroup, SleeveLength } from './catalogTypes'

export const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'outerwear', label: 'Outerwear' },
  { value: 'dress', label: 'Dress' },
  { value: 'shoes', label: 'Shoes' },
  { value: 'accessory', label: 'Accessory' },
]

export const SLEEVE_OPTIONS: { value: SleeveLength; label: string }[] = [
  { value: 'short_sleeve', label: 'Short sleeve' },
  { value: 'long_sleeve', label: 'Long sleeve' },
  { value: 'sleeveless', label: 'Sleeveless' },
]

export const SOURCE_OPTIONS: { value: 'all' | 'team' | CatalogSourceGroup; label: string }[] = [
  { value: 'all', label: 'All sources' },
  { value: 'team', label: 'Team photos' },
  { value: 'edited_clothing', label: 'AI-edited' },
  { value: 'catalog_references', label: 'Catalog references' },
]

export const FLAG_LABEL: Record<string, string> = {
  synthetic_edit: 'AI-edited image',
  third_party_source_likely: 'Likely third-party image',
  photo_background_not_removed: 'Background not removed',
  third_party_graphic: 'Third-party graphic print',
  possible_duplicate: 'Possible duplicate',
  category_unclear: 'Category unclear',
}
