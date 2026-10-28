// The single list of choices used by the upload form, the edit form and the filters.
// "value" is what is saved in the database. "label" is what the person sees.

export interface Option { value: string; label: string; hint?: string }

export const CATEGORIES: Option[] = [
  { value: 'top', label: 'Top', hint: 'shirt, blouse, T-shirt, sweater' },
  { value: 'bottom', label: 'Bottom', hint: 'pants, jeans, skirt, shorts' },
  { value: 'dress', label: 'Dress / one-piece', hint: 'dress, jumpsuit, baju kurung set, abaya' },
  { value: 'outerwear', label: 'Outerwear', hint: 'jacket, blazer, coat, cardigan' },
  { value: 'shoes', label: 'Shoes', hint: 'sneakers, heels, loafers' },
  { value: 'accessory', label: 'Accessory', hint: 'watch, belt, shawl, bag' },
]

const o = (value: string, label: string): Option => ({ value, label })
const NOT_SURE = o('unknown', 'Not sure')

// Patterns and materials depend on the kind of item. Shoes and accessories get their own lists,
// and every list has "Not sure", because people often do not know what a shoe is made of.
const CLOTH_PATTERNS = [
  o('plain', 'Plain'), o('striped', 'Striped'), o('checked', 'Checked'), o('floral', 'Floral'),
  o('polka dot', 'Polka dot'), o('graphic print', 'Graphic print'), o('batik', 'Batik / songket'), o('other', 'Other'),
]

export const PATTERNS_BY_CATEGORY: Record<string, Option[]> = {
  top: CLOTH_PATTERNS,
  bottom: CLOTH_PATTERNS,
  dress: CLOTH_PATTERNS,
  outerwear: [o('plain', 'Plain'), o('checked', 'Checked'), o('striped', 'Striped'), o('graphic print', 'Graphic print'), o('other', 'Other')],
  shoes: [o('plain', 'Plain'), o('two-tone', 'Two-tone'), o('glitter', 'Glitter or sparkle'), o('embellished', 'Embellished'),
    o('printed', 'Printed'), o('other', 'Other'), NOT_SURE],
  accessory: [o('plain', 'Plain'), o('studded', 'Studded or embellished'), o('beaded', 'Beaded'), o('striped', 'Striped'),
    o('floral', 'Floral'), o('printed', 'Printed'), o('other', 'Other'), NOT_SURE],
}

export const FABRICS_BY_CATEGORY: Record<string, Option[]> = {
  top: [o('cotton', 'Cotton'), o('linen', 'Linen'), o('silk', 'Silk or satin'), o('chiffon', 'Chiffon'), o('knit', 'Knit'),
    o('polyester', 'Polyester'), o('denim', 'Denim'), o('lace', 'Lace'), o('other', 'Other')],
  bottom: [o('cotton', 'Cotton'), o('denim', 'Denim'), o('linen', 'Linen'), o('polyester', 'Polyester'), o('knit', 'Knit'),
    o('silk', 'Silk or satin'), o('leather', 'Leather'), o('other', 'Other')],
  dress: [o('cotton', 'Cotton'), o('chiffon', 'Chiffon'), o('silk', 'Silk or satin'), o('lace', 'Lace'), o('polyester', 'Polyester'),
    o('linen', 'Linen'), o('knit', 'Knit'), o('other', 'Other')],
  outerwear: [o('denim', 'Denim'), o('wool', 'Wool'), o('leather', 'Leather'), o('cotton', 'Cotton'), o('polyester', 'Polyester'),
    o('nylon', 'Nylon'), o('knit', 'Knit'), o('other', 'Other')],
  shoes: [o('leather', 'Leather'), o('faux leather', 'Faux leather'), o('suede', 'Suede'), o('canvas', 'Canvas'), o('rubber', 'Rubber'),
    o('mesh', 'Mesh or knit'), o('fabric', 'Fabric or satin'), o('plastic', 'Plastic or jelly'), o('other', 'Other'), NOT_SURE],
  accessory: [o('metal', 'Metal'), o('leather', 'Leather'), o('fabric', 'Fabric'), o('silk', 'Silk'), o('pearl', 'Pearl or beads'),
    o('plastic', 'Plastic or resin'), o('wood', 'Wood'), o('canvas', 'Canvas'), o('glass', 'Glass'), o('other', 'Other'), NOT_SURE],
}

export const patternsFor = (category: string): Option[] => PATTERNS_BY_CATEGORY[category] ?? CLOTH_PATTERNS
export const materialsFor = (category: string): Option[] => FABRICS_BY_CATEGORY[category] ?? FABRICS_BY_CATEGORY.top
export const materialLabel = (category: string) => (category === 'shoes' || category === 'accessory' ? 'Material' : 'Fabric')

// For the filter: every pattern that exists, once.
export const ALL_PATTERNS: Option[] = Object.values(PATTERNS_BY_CATEGORY).flat()
  .filter((p, i, all) => all.findIndex(x => x.value === p.value) === i)

/** What to pre-select when the category changes. */
export const defaultsFor = (category: string) => ({
  pattern: 'plain',
  fabric: category === 'shoes' || category === 'accessory' ? 'unknown' : materialsFor(category)[0].value,
})

// The kind of accessory. Each outfit can take one of several of these.
export const ACCESSORY_TYPES: Option[] = [
  o('bag', 'Bag'), o('watch', 'Watch'), o('ring', 'Ring'), o('necklace', 'Necklace'), o('earrings', 'Earrings'),
  o('bracelet', 'Bracelet'), o('brooch', 'Brooch'),
  { value: 'neckwear', label: 'Neckwear', hint: 'scarf, tie, bow tie, shawl' },
  o('hat', 'Hat'),
  { value: 'hairwear', label: 'Hairwear', hint: 'clip, band, scrunchie, tudung pin' },
  o('eyewear', 'Eyewear'), o('gloves', 'Gloves'),
  { value: 'legwear', label: 'Legwear', hint: 'stockings, tights, socks' },
  o('belt', 'Belt'), o('other', 'Other'),
]

// Malaysia has no four seasons, so "season" means the weather you wear it in.
export const SEASONS: Option[] = [
  { value: 'all', label: 'All year', hint: 'fine in any weather' },
  { value: 'hot', label: 'Hot and sunny', hint: 'light and breathable' },
  { value: 'rainy', label: 'Rainy season', hint: 'quick-dry, covers well' },
  { value: 'cool', label: 'Cool or air-con', hint: 'layers, knits, jackets' },
]

// Formality is 1 to 5 in the database (the AI models use the number).
// People pick it by a named level with an example, not by a slider.
export const FORMALITY: Option[] = [
  { value: '1', label: 'Loungewear', hint: 'at home, sleepwear, gym and sportswear' },
  { value: '2', label: 'Casual', hint: 'T-shirt and jeans, hanging out' },
  { value: '3', label: 'Smart casual', hint: 'polo, chinos, a nice blouse' },
  { value: '4', label: 'Business', hint: 'office, presentation, job interview' },
  { value: '5', label: 'Formal', hint: 'wedding, graduation, ceremony' },
]

export const labelOf = (list: Option[], value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') return ''
  return list.find(o => o.value === String(value))?.label ?? String(value)
}

/** The occasions an item suits, e.g. "Business, Formal" or "All occasions". */
export function occasionText(levels: number[] | null | undefined, fallback: number): string {
  const l = levels && levels.length ? [...levels].sort() : [fallback]
  if (l.length === 5) return 'All occasions'
  return l.map(n => labelOf(FORMALITY, n)).join(', ')
}

/** One typical level saved in the old `formality` column (the middle of the chosen ones). */
export const typicalLevel = (levels: number[]): number => {
  const l = [...levels].sort()
  return l[Math.floor((l.length - 1) / 2)]
}

export interface Tags {
  name: string
  category: string
  color: string
  pattern: string
  fabric: string
  season: string
  formality: number             // typical level, kept for older code
  formality_levels: number[]    // every occasion level the item suits
  subtype: string               // only for accessories: bag, watch, ring... ('' for everything else)
}

export const DEFAULT_TAGS: Tags = {
  name: '', category: 'top', color: '#808080', pattern: 'plain', fabric: 'cotton', season: 'all',
  formality: 2, formality_levels: [2], subtype: '',
}
