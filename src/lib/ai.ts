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
