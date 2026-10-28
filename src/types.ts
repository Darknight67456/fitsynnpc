export type Category = 'top' | 'bottom' | 'outerwear' | 'dress' | 'shoes' | 'accessory'

export interface ClothingItem {
  id: string
  user_id: string
  name: string
  image_url: string | null
  category: Category
  color: string            // hex
  pattern: string
  fabric: string | null
  season: string
  formality: number        // 1 (very casual) to 5 (very formal): the typical level
  formality_levels?: number[] | null   // every level the item suits; all 5 = all occasions
  tags: string[]
  wear_count: number
  last_worn_at: string | null
  subtype?: string | null         // accessories only: bag, watch, ring...
  embedding?: number[] | null     // set by the AI service
  color_feat?: number[] | null
}

export interface BodyProfile {
  user_id: string
  height_cm: number
  weight_kg: number
  chest: number
  waist: number
  hips: number
  shoulder: number
  fit_pref: string
  skin_undertone: 'warm' | 'cool' | 'neutral'
}

export interface SizeChartRow {
  brand: string
  category: string
  size: string
  chest_min: number; chest_max: number
  waist_min: number; waist_max: number
  hips_min: number;  hips_max: number
}

export interface Outfit {
  items: ClothingItem[]
  occasion?: string
  colorScore: number
  reason: string
}