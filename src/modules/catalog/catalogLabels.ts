import type { Category } from '../../types'
import type { CatalogSourceGroup, GarmentGender, SleeveLength } from './catalogTypes'

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

export const GENDER_OPTIONS: { value: GarmentGender; label: string }[] = [
  { value: 'unisex', label: 'Unisex' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
]

export const SOURCE_OPTIONS: { value: 'all' | 'team' | CatalogSourceGroup; label: string }[] = [
  { value: 'all', label: 'All sources' },
  { value: 'team', label: 'Team photos' },
  { value: 'edited_clothing', label: 'AI-edited' },
  { value: 'catalog_references', label: 'Catalog references' },
  { value: 'fashion_catalog', label: 'Fashion catalog' },
]

// Display names for stored codes the generic rule below would get wrong.
const CODE_LABEL: Record<string, string> = {
  tshirt: 'T-shirt',
  graphic_tshirt: 'Graphic T-shirt',
  ringer_tshirt: 'Ringer T-shirt',
  raglan_tshirt: 'Raglan T-shirt',
  boxy_tshirt: 'Boxy T-shirt',
  long_sleeve_tshirt: 'Long-sleeve T-shirt',
  layered_long_sleeve_tshirt: 'Layered-sleeve T-shirt',
  henley_tshirt: 'Henley T-shirt',
  button_down_shirt: 'Button-up shirt',
  camp_collar_shirt: 'Camp-collar shirt',
  wide_leg_jeans: 'Wide-leg jeans',
  straight_leg_jeans: 'Straight-leg jeans',
  wide_leg_trousers: 'Wide-leg trousers',
  wide_leg_sweatpants: 'Wide-leg sweatpants',
  pyjama_trousers: 'Pyjama-style trousers',
  off_shoulder_top: 'Off-shoulder top',
  tie_front_blouse: 'Tie-front blouse',
  chinese_new_year: 'Chinese New Year',
  hari_raya: 'Hari Raya',
  single_item: 'Single item',
  draped_garment: 'Draped garment',
}

/** "smart_casual" → "Smart casual", with the exceptions above. */
export function codeLabel(code: string): string {
  if (CODE_LABEL[code]) return CODE_LABEL[code]
  const words = code.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const FLAG_LABEL: Record<string, string> = {
  synthetic_edit: 'AI-edited image',
  third_party_source_likely: 'Likely third-party image',
  photo_background_not_removed: 'Background not removed',
  third_party_graphic: 'Third-party graphic print',
  possible_duplicate: 'Possible duplicate',
  category_unclear: 'Category unclear',
  needs_manual_review: 'Needs manual review',
  set_contents_unconfirmed: 'Set contents not confirmed',
  item_kind_unclear: 'Single item or set unclear',
}
