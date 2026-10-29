import type { ClothingItem } from '../../types'
import type { TagSuggestion } from '../../lib/ai'
import { colorName } from './colorFamily'
import {
  ACCESSORY_TYPES, CATEGORIES, SEASONS, labelOf, materialsFor, patternsFor, typicalLevel, type Tags,
} from './options'

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

/** Turns the AI's suggestions into form values. Anything that is not a valid choice is ignored.
 *  Returns the new tags and the names of the fields the AI filled in. */
export function applySuggestion(prev: Tags, s: TagSuggestion): { next: Tags; filled: string[] } {
  const f = s.fields
  const next: Tags = { ...prev }
  const filled: string[] = []
  const fill = <K extends keyof Tags>(key: K, value: Tags[K]) => { next[key] = value; filled.push(key) }

  if (typeof f.category === 'string' && CATEGORIES.some(c => c.value === f.category)) fill('category', f.category)
  if (next.category === 'accessory') {
    if (typeof f.subtype === 'string' && ACCESSORY_TYPES.some(t => t.value === f.subtype)) fill('subtype', f.subtype)
  } else {
    next.subtype = ''
  }
  if (isHex(f.color)) fill('color', f.color)
  if (typeof f.pattern === 'string' && f.pattern !== 'other' && patternsFor(next.category).some(p => p.value === f.pattern)) {
    fill('pattern', f.pattern)
  }
  if (typeof f.fabric === 'string' && f.fabric !== 'other' && materialsFor(next.category).some(m => m.value === f.fabric)) {
    fill('fabric', f.fabric)
  }
  if (typeof f.season === 'string' && SEASONS.some(x => x.value === f.season)) fill('season', f.season)
  if (Array.isArray(f.formality_levels)) {
    const levels = f.formality_levels.map(Number).filter(n => n >= 1 && n <= 5)
    if (levels.length) {
      next.formality_levels = levels
      next.formality = typicalLevel(levels)
      filled.push('formality_levels')
    }
  }

  // a starting name, only when the user has not typed one
  if (!prev.name.trim() && filled.includes('category')) {
    const noun = next.category === 'accessory' && next.subtype
      ? labelOf(ACCESSORY_TYPES, next.subtype) : labelOf(CATEGORIES, next.category)
    const material = filled.includes('fabric') && next.fabric !== 'unknown' ? labelOf(materialsFor(next.category), next.fabric).split(' ')[0] : ''
    const name = [colorName(next.color), material, noun].filter(Boolean).join(' ')
    next.name = name.charAt(0).toUpperCase() + name.slice(1)
    filled.push('name')
  }
  return { next, filled }
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot                      // both fingerprints have length 1, so the dot product is the cosine
}

/** Image retrieval: items already in the wardrobe whose photos look like this one.
 *  The 0.88 cut-off is a first guess and has not been tuned on real photos. */
export const SIMILAR_MIN = 0.88

export function findSimilar(embedding: number[], items: ClothingItem[], n = 3): { item: ClothingItem; similarity: number }[] {
  return items
    .filter(i => Array.isArray(i.embedding) && i.embedding.length === embedding.length)
    .map(item => ({ item, similarity: cosine(embedding, item.embedding as number[]) }))
    .filter(x => x.similarity >= SIMILAR_MIN)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, n)
}
