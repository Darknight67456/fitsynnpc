import type { ClothingItem } from '../../types'
import { colorName } from './colorFamily'

export interface Filters {
  search: string
  category: string
  season: string
  color: string
  pattern: string
  sort: 'newest' | 'most-worn' | 'least-worn' | 'name'
}

export const NO_FILTERS: Filters = {
  search: '', category: 'all', season: 'all', color: 'all', pattern: 'all', sort: 'newest',
}

export const filtersActive = (f: Filters) =>
  f.search !== '' || f.category !== 'all' || f.season !== 'all' || f.color !== 'all' || f.pattern !== 'all'

export function applyFilters(items: ClothingItem[], f: Filters): ClothingItem[] {
  const q = f.search.trim().toLowerCase()
  const out = items.filter(i =>
    (!q || `${i.name} ${i.subtype ?? ''} ${i.fabric ?? ''} ${i.pattern} ${(i.tags ?? []).join(' ')}`.toLowerCase().includes(q)) &&
    (f.category === 'all' || i.category === f.category) &&
    // an "all year" item fits every season, so it also shows when you pick one
    (f.season === 'all' || i.season === f.season || i.season === 'all') &&
    (f.color === 'all' || colorName(i.color) === f.color) &&
    (f.pattern === 'all' || i.pattern === f.pattern))

  const sorted = [...out]
  if (f.sort === 'most-worn') sorted.sort((a, b) => b.wear_count - a.wear_count)
  else if (f.sort === 'least-worn') sorted.sort((a, b) => a.wear_count - b.wear_count)
  else if (f.sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
  return sorted // 'newest' keeps the order the database returned (newest first)
}
