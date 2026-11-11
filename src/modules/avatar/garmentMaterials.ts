import { CanvasTexture, Color, RepeatWrapping, SRGBColorSpace } from 'three'
import type { ClothingItem } from '../../types'

export interface FabricPBRProps {
  color: string
  roughness: number
  metalness: number
  patternTexture: CanvasTexture | null
}

/**
 * Returns realistic PBR roughness and metalness values for a given fabric type.
 */
export function getFabricSurfaceProps(fabric: string | null | undefined): {
  roughness: number
  metalness: number
} {
  const f = (fabric ?? '').toLowerCase()
  if (f.includes('leather')) return { roughness: 0.34, metalness: 0.12 }
  if (f.includes('silk') || f.includes('satin')) return { roughness: 0.36, metalness: 0.08 }
  if (f.includes('chiffon')) return { roughness: 0.52, metalness: 0.03 }
  if (f.includes('denim')) return { roughness: 0.84, metalness: 0.02 }
  if (f.includes('knit') || f.includes('wool')) return { roughness: 0.88, metalness: 0.01 }
  if (f.includes('linen')) return { roughness: 0.82, metalness: 0.02 }
  if (f.includes('polyester')) return { roughness: 0.58, metalness: 0.05 }
  // Default cotton / woven fabric
  return { roughness: 0.74, metalness: 0.02 }
}

const textureCache = new Map<string, CanvasTexture>()

/**
 * Generates a seamless, tileable procedural CanvasTexture for patterned garments
 * ('floral', 'striped', 'checkered', 'polka dot', 'graphic print') so 3D garments
 * never stretch 2D text labels or room backgrounds across 360-degree meshes.
 */
export function getProceduralPatternTexture(
  baseHex: string,
  pattern: string | null | undefined
): CanvasTexture | null {
  const pat = (pattern ?? 'plain').toLowerCase().trim()
  if (!pat || pat === 'plain' || pat === 'solid') return null

  const cacheKey = `${baseHex}__${pat}`
  const cached = textureCache.get(cacheKey)
  if (cached) return cached

  if (typeof document === 'undefined') return null

  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const base = new Color(baseHex || '#888888')
  const hsl = { h: 0, s: 0, l: 0 }
  base.getHSL(hsl)

  const lighter = new Color().setHSL(
    hsl.h,
    Math.max(0.12, hsl.s * 0.78),
    Math.min(0.96, hsl.l + 0.24)
  )
  const darker = new Color().setHSL(
    (hsl.h + 0.32) % 1,
    Math.min(0.55, hsl.s * 0.65),
    Math.max(0.16, hsl.l - 0.14)
  )
  const accent = new Color().setHSL(
    (hsl.h + 0.06) % 1,
    Math.min(0.88, hsl.s + 0.15),
    Math.min(0.92, hsl.l + 0.28)
  )

  // Fill base fabric background
  ctx.fillStyle = `#${base.getHexString()}`
  ctx.fillRect(0, 0, size, size)

  // Subtle woven fabric micro-grain
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)'
  for (let y = 0; y < size; y += 4) {
    ctx.fillRect(0, y, size, 1)
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.025)'
  for (let x = 0; x < size; x += 4) {
    ctx.fillRect(x, 0, 1, size)
  }

  if (pat.includes('strip')) {
    // Crisp vertical woven stripes
    const stripeCount = 16
    const step = size / stripeCount
    ctx.fillStyle = `#${lighter.getHexString()}`
    for (let i = 0; i < stripeCount; i++) {
      ctx.fillRect(i * step, 0, step * 0.36, size)
    }
  } else if (pat.includes('floral')) {
    // Delicate repeating botanical / floral motifs with seamless 9-tile wrapping
    const baseMotifs: Array<[number, number, number]> = [
      [84, 88, 1.0],
      [256, 72, 0.85],
      [416, 108, 0.95],
      [168, 216, 0.9],
      [348, 232, 1.05],
      [72, 356, 0.88],
      [244, 384, 1.0],
      [428, 368, 0.92],
      [156, 468, 0.82],
      [340, 476, 0.86],
    ]
    const tileOffsets = [-size, 0, size]
    for (const [bx, by, scale] of baseMotifs) {
      for (const ox of tileOffsets) {
        for (const oy of tileOffsets) {
          const cx = bx + ox
          const cy = by + oy
          if (cx < -48 || cx > size + 48 || cy < -48 || cy > size + 48) continue

          // Paired botanical leaves
          ctx.fillStyle = `#${darker.getHexString()}`
          ctx.beginPath()
          ctx.ellipse(cx + 12 * scale, cy + 9 * scale, 11 * scale, 5 * scale, Math.PI / 5, 0, Math.PI * 2)
          ctx.fill()
          ctx.beginPath()
          ctx.ellipse(cx - 11 * scale, cy - 8 * scale, 9 * scale, 4.2 * scale, -Math.PI / 4, 0, Math.PI * 2)
          ctx.fill()

          // 5-petal blossom
          ctx.fillStyle = `#${lighter.getHexString()}`
          for (let p = 0; p < 5; p++) {
            const angle = (p * Math.PI * 2) / 5 + 0.2
            const px = cx + Math.cos(angle) * 10.5 * scale
            const py = cy + Math.sin(angle) * 10.5 * scale
            ctx.beginPath()
            ctx.arc(px, py, 7.8 * scale, 0, Math.PI * 2)
            ctx.fill()
          }

          // Warm blossom center
          ctx.fillStyle = `#${accent.getHexString()}`
          ctx.beginPath()
          ctx.arc(cx, cy, 4.8 * scale, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
  } else if (pat.includes('check') || pat.includes('plaid') || pat.includes('gingham')) {
    const step = 64
    ctx.globalAlpha = 0.28
    ctx.fillStyle = `#${lighter.getHexString()}`
    for (let i = 0; i < size; i += step) {
      ctx.fillRect(i, 0, step / 2, size)
      ctx.fillRect(0, i, size, step / 2)
    }
    ctx.globalAlpha = 1.0
  } else if (pat.includes('dot') || pat.includes('polka')) {
    ctx.fillStyle = `#${lighter.getHexString()}`
    const step = 64
    for (let y = 32; y < size; y += step) {
      for (let x = 32; x < size; x += step) {
        const offsetX = (Math.floor(y / step) % 2) * (step / 2)
        ctx.beginPath()
        ctx.arc((x + offsetX) % size, y, 8, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  } else if (pat.includes('graphic')) {
    // Subtle geometric chest motif band
    ctx.strokeStyle = `#${lighter.getHexString()}`
    ctx.lineWidth = 8
    ctx.strokeRect(72, 144, size - 144, size - 288)
    ctx.fillStyle = `#${accent.getHexString()}`
    ctx.fillRect(112, 216, size - 224, 56)
  }

  const tex = new CanvasTexture(canvas)
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.repeat.set(4, 3)
  tex.colorSpace = SRGBColorSpace
  tex.needsUpdate = true

  textureCache.set(cacheKey, tex)
  return tex
}

/**
 * Computes complete PBR material props for a ClothingItem using Supabase wardrobe metadata.
 */
export function resolveGarmentMaterial(item: ClothingItem): FabricPBRProps {
  const combinedMeta = `${item.name || ''} ${(item.tags || []).join(' ')}`.toLowerCase()
  const effectiveFabric = item.fabric || (combinedMeta.includes('leather') ? 'leather' : combinedMeta.includes('silk') || combinedMeta.includes('satin') ? 'silk' : combinedMeta.includes('denim') || combinedMeta.includes('jean') ? 'denim' : 'cotton')
  const { roughness, metalness } = getFabricSurfaceProps(effectiveFabric)

  let effectivePattern = item.pattern
  if (!effectivePattern || effectivePattern === 'plain') {
    if (combinedMeta.includes('floral')) effectivePattern = 'floral'
    else if (combinedMeta.includes('strip')) effectivePattern = 'striped'
    else if (combinedMeta.includes('plaid') || combinedMeta.includes('check') || combinedMeta.includes('gingham')) effectivePattern = 'checkered'
    else if (combinedMeta.includes('polka') || combinedMeta.includes('dot')) effectivePattern = 'polka dot'
  }

  const patternTexture = getProceduralPatternTexture(item.color, effectivePattern)
  return {
    color: patternTexture ? '#ffffff' : item.color || '#cccccc',
    roughness,
    metalness,
    patternTexture,
  }
}

