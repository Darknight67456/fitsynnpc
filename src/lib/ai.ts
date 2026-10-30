// Talks to the FitSync AI service (ai/service/main.py).
export const AI_URL: string = import.meta.env.VITE_AI_URL ?? 'http://localhost:8000'

export interface Embedding { embedding: number[]; color_feat: number[] }

export async function embedImage(image: Blob): Promise<Embedding> {
  const body = new FormData()
  body.append('file', image, 'item.png')
  const res = await fetch(`${AI_URL}/embed`, { method: 'POST', body })
  if (!res.ok) throw new Error('AI service could not read the photo.')
  return res.json() as Promise<Embedding>
}

export interface TagSuggestion {
  source: string
  fields: Record<string, unknown>
  confidence: Record<string, number>
  embedding: number[]
  trained: boolean
}

// Reads one clothing photo and returns SUGGESTED tags. Nothing is saved.
export async function suggestTags(photo: Blob): Promise<TagSuggestion> {
  const body = new FormData()
  body.append('photo', photo, 'item.jpg')
  const res = await fetch(`${AI_URL}/tag`, { method: 'POST', body })
  if (!res.ok) throw new Error('AI service could not read the photo.')
  return res.json() as Promise<TagSuggestion>
}

export interface Detected { category: string; subtype: string | null; color: string; image: string }
export interface Suggestion {
  target: string
  reason: string
  picks: { item_id: string; score: number }[]
}
export interface AssistResult {
  detected: Detected[]
  targets: Suggestion[]
  formality: number | null
  message: string
  mode?: 'person' | 'item'      // 'item' = the photo shows one piece, not a person wearing clothes
}

export async function assist(photo: Blob, prompt: string, items: object[]): Promise<AssistResult> {
  const body = new FormData()
  body.append('photo', photo, 'selfie.jpg')
  body.append('prompt', prompt)
  body.append('items', JSON.stringify(items))
  const res = await fetch(`${AI_URL}/assist`, { method: 'POST', body })
  if (!res.ok) throw new Error('The AI service returned an error.')
  return res.json() as Promise<AssistResult>
}

export interface Outfit { item_ids: string[]; score: number; reason: string }
export interface RecommendResult { formality: number; weather: string; message: string; notes: string[]; outfits: Outfit[] }

export async function recommend(args: {
  event: string
  items: { id: string; name: string; category: string; season: string; formality: number; formality_levels: number[]; subtype: string; wear_count: number; embedding: number[] }[]
  formality?: number
  weather?: string
  outerwear?: 'auto' | 'yes' | 'no'
  accessories?: string[]
}): Promise<RecommendResult> {
  const res = await fetch(`${AI_URL}/recommend`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error('The AI service returned an error.')
  return res.json() as Promise<RecommendResult>
}

// ---------------- Module 3: color theory ----------------
export type Undertone = 'warm' | 'cool' | 'neutral'

export interface ColorPayload { id: string; color: string; category: string; subtype?: string | null; embedding?: number[] | null }
export interface ColorPick { item_id: string; score: number; color_score: number; style_score: number | null; scheme: string; reason: string }
export interface ColorGroup { group: string; category: string; picks: ColorPick[] }
export interface ColorMatchResult { groups: ColorGroup[]; learned_score: boolean }
export interface ColorCheckResult {
  score: number
  scheme: string
  reason: string
  weakest: { item_id: string | null; gain_if_removed: number } | null
}
export interface UndertoneResult { undertone: Undertone | null; confidence?: number; part?: string; color?: string; message: string }

async function postJson<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${AI_URL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('The AI service returned an error.')
  return res.json() as Promise<T>
}

export const colorMatch = (anchor: ColorPayload, candidates: ColorPayload[], undertone: Undertone | null) =>
  postJson<ColorMatchResult>('/color-match', { anchor, candidates, undertone })

export const colorCheck = (items: ColorPayload[], undertone: Undertone | null) =>
  postJson<ColorCheckResult>('/color-score', { items, undertone })

export async function detectUndertone(photo: Blob): Promise<UndertoneResult> {
  const body = new FormData()
  body.append('photo', photo, 'selfie.jpg')
  const res = await fetch(`${AI_URL}/undertone`, { method: 'POST', body })
  if (!res.ok) throw new Error('The AI service could not read the photo.')
  return res.json() as Promise<UndertoneResult>
}
