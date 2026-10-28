import type { BodyProfile, ClothingItem } from '../types'

// A flat colored placeholder picture (works offline, no external image needed).
const img = (hex: string, label: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='500'>` +
      `<rect width='100%' height='100%' fill='${hex}'/>` +
      `<text x='50%' y='50%' fill='white' stroke='black' stroke-width='1' font-size='26' ` +
      `text-anchor='middle' font-family='sans-serif'>${label}</text></svg>`
  )

type Seed = Pick<
  ClothingItem,
  'name' | 'category' | 'color' | 'pattern' | 'fabric' | 'season' | 'formality'
> & { tags?: string[]; wear?: number; last?: string | null; levels?: number[]; subtype?: string }

const build = (s: Seed, i: number): ClothingItem => ({
  id: `seed-${String(i + 1).padStart(2, '0')}`,
  user_id: 'seed-user',
  name: s.name,
  image_url: img(s.color, s.name),
  category: s.category,
  color: s.color,
  pattern: s.pattern,
  fabric: s.fabric,
  season: s.season,
  formality: s.formality,
  formality_levels: s.levels ?? [s.formality],
  subtype: s.subtype ?? null,
  tags: s.tags ?? [],
  wear_count: s.wear ?? 0,
  last_worn_at: s.last ?? null,
})

// formality: 1 = loungewear, 2 = casual, 3 = smart casual, 4 = business, 5 = formal
// season: all = all year, hot = hot and sunny, rainy = rainy season, cool = cool or air-con
const raw: Seed[] = [
  // ---- 10 tops ----
  { name: 'White Oxford Shirt', category: 'top', color: '#f8f8f5', pattern: 'plain', fabric: 'cotton', season: 'all', formality: 4, tags: ['office', 'formal'], wear: 12, last: '2026-10-10' },
  { name: 'Black Crew T-shirt', category: 'top', color: '#1a1a1a', pattern: 'plain', fabric: 'cotton', season: 'all', formality: 2, tags: ['basic'], wear: 20, last: '2026-10-15' },
  { name: 'Navy Polo Shirt', category: 'top', color: '#1f3a5f', pattern: 'plain', fabric: 'cotton', season: 'hot', formality: 3, tags: ['smart-casual'], wear: 8, last: '2026-10-05' },
  { name: 'Light Blue Striped Shirt', category: 'top', color: '#9ec5e8', pattern: 'striped', fabric: 'cotton', season: 'all', formality: 3, tags: ['smart-casual'], wear: 5, last: '2026-09-28' },
  { name: 'Mustard Knit Sweater', category: 'top', color: '#d4a017', pattern: 'plain', fabric: 'knit', season: 'cool', formality: 2, wear: 1, last: '2026-08-02' },
  { name: 'Red Floral Blouse', category: 'top', color: '#c0392b', pattern: 'floral', fabric: 'polyester', season: 'hot', formality: 3, tags: ['party'] },
  { name: 'Cream Silk Blouse', category: 'top', color: '#f3e9d2', pattern: 'plain', fabric: 'silk', season: 'all', formality: 4, tags: ['formal', 'office'], wear: 2, last: '2026-07-20' },
  { name: 'Olive Graphic Tee', category: 'top', color: '#6b7a3a', pattern: 'graphic print', fabric: 'cotton', season: 'hot', formality: 1, tags: ['streetwear'], wear: 6, last: '2026-10-12' },
  { name: 'Maroon Baju Kurung Top', category: 'top', color: '#7b1e3a', pattern: 'plain', fabric: 'silk', season: 'all', formality: 4, tags: ['traditional', 'festive'], wear: 1, last: '2026-04-10' },
  { name: 'Grey Hoodie', category: 'top', color: '#8d8d8d', pattern: 'plain', fabric: 'cotton', season: 'cool', formality: 1, tags: ['sportswear', 'streetwear'], wear: 15, last: '2026-10-14' },

  // ---- 8 bottoms ----
  { name: 'Black Slim Trousers', category: 'bottom', color: '#1c1c1c', pattern: 'plain', fabric: 'polyester', season: 'all', formality: 4, tags: ['formal', 'office'], wear: 10, last: '2026-10-10' },
  { name: 'Navy Chinos', category: 'bottom', color: '#2b3a55', pattern: 'plain', fabric: 'cotton', season: 'all', formality: 3, tags: ['smart-casual'], wear: 7, last: '2026-10-05' },
  { name: 'Blue Denim Jeans', category: 'bottom', color: '#3b5b8c', pattern: 'plain', fabric: 'denim', season: 'all', formality: 2, wear: 18, last: '2026-10-16' },
  { name: 'Beige Linen Pants', category: 'bottom', color: '#d9c8a9', pattern: 'plain', fabric: 'linen', season: 'hot', formality: 3, wear: 3, last: '2026-09-01' },
  { name: 'Charcoal Pleated Skirt', category: 'bottom', color: '#4a4a4f', pattern: 'plain', fabric: 'polyester', season: 'all', formality: 4, tags: ['office'], wear: 2, last: '2026-08-15' },
  { name: 'Black Sports Shorts', category: 'bottom', color: '#222222', pattern: 'plain', fabric: 'polyester', season: 'hot', formality: 1, tags: ['sportswear'], wear: 9, last: '2026-10-13' },
  { name: 'Olive Cargo Pants', category: 'bottom', color: '#5b6b3a', pattern: 'plain', fabric: 'cotton', season: 'all', formality: 2, tags: ['streetwear'] },
  { name: 'Pink Floral Midi Skirt', category: 'bottom', color: '#e8b4c8', pattern: 'floral', fabric: 'polyester', season: 'hot', formality: 3, tags: ['party'], wear: 1, last: '2026-06-21' },

  // ---- 4 outerwear ----
  { name: 'Navy Blazer', category: 'outerwear', color: '#1b2a49', pattern: 'plain', fabric: 'wool', season: 'cool', formality: 4, tags: ['formal', 'office'], wear: 4, last: '2026-09-30' },
  { name: 'Black Leather Jacket', category: 'outerwear', color: '#111111', pattern: 'plain', fabric: 'leather', season: 'cool', formality: 2, tags: ['streetwear'], wear: 3, last: '2026-09-12' },
  { name: 'Denim Jacket', category: 'outerwear', color: '#5d82b5', pattern: 'plain', fabric: 'denim', season: 'cool', formality: 2, wear: 6, last: '2026-10-01' },
  { name: 'Beige Trench Coat', category: 'outerwear', color: '#c8b08a', pattern: 'plain', fabric: 'cotton', season: 'rainy', formality: 4 },

  // ---- 2 dresses / one-pieces ----
  { name: 'Floral Midi Dress', category: 'dress', color: '#d98ca3', pattern: 'floral', fabric: 'chiffon', season: 'hot', formality: 3, tags: ['party'], wear: 2, last: '2026-09-14' },
  { name: 'Black Evening Dress', category: 'dress', color: '#141414', pattern: 'plain', fabric: 'silk', season: 'all', formality: 5, tags: ['formal'], wear: 1, last: '2026-06-02' },

  // ---- 5 shoes ----
  { name: 'Black Oxford Shoes', category: 'shoes', color: '#151515', pattern: 'plain', fabric: 'leather', season: 'all', formality: 4, levels: [4, 5], tags: ['formal'], wear: 5, last: '2026-10-10' },
  { name: 'White Sneakers', category: 'shoes', color: '#f5f5f5', pattern: 'plain', fabric: 'leather', season: 'all', formality: 2, levels: [1, 2, 3], wear: 25, last: '2026-10-16' },
  { name: 'Brown Loafers', category: 'shoes', color: '#7a4a2b', pattern: 'plain', fabric: 'leather', season: 'all', formality: 4, tags: ['smart-casual'], wear: 4, last: '2026-09-25' },
  { name: 'Red Heels', category: 'shoes', color: '#b3202a', pattern: 'plain', fabric: 'leather', season: 'all', formality: 4, tags: ['party'] },
  { name: 'Grey Running Shoes', category: 'shoes', color: '#9a9a9a', pattern: 'plain', fabric: 'polyester', season: 'all', formality: 1, tags: ['sportswear'], wear: 11, last: '2026-10-13' },

  // ---- 3 accessories ----
  { name: 'Silver Wrist Watch', category: 'accessory', subtype: 'watch', color: '#c0c0c0', pattern: 'plain', fabric: 'metal', season: 'all', formality: 3, levels: [2, 3, 4, 5], wear: 14, last: '2026-10-15' },
  { name: 'Black Leather Belt', category: 'accessory', subtype: 'belt', color: '#1a1a1a', pattern: 'plain', fabric: 'leather', season: 'all', formality: 3, wear: 9, last: '2026-10-10' },
  { name: 'Dusty Rose Silk Shawl', category: 'accessory', subtype: 'neckwear', color: '#d8a7b1', pattern: 'plain', fabric: 'silk', season: 'all', formality: 4, tags: ['modest', 'traditional'], wear: 2, last: '2026-05-01' },
]

export const seedItems: ClothingItem[] = raw.map(build)

export const seedByCategory = (category: ClothingItem['category']) =>
  seedItems.filter((i) => i.category === category)

// A demo body profile so the avatar and size pages can be tested without the profile form.
export const seedProfile: BodyProfile = {
  user_id: 'seed-user',
  height_cm: 165,
  weight_kg: 58,
  chest: 88,
  waist: 72,
  hips: 96,
  shoulder: 38,
  fit_pref: 'regular',
  skin_undertone: 'warm',
}