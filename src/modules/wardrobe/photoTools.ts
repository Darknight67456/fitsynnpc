// ---------- 1. Main color of a clothing photo ----------

// Pure function: works on raw RGBA pixel data, so it can be tested without a browser.
// If the photo has transparent pixels (after background removal) it uses every visible pixel.
// Otherwise it uses only the center 40% of the picture, to ignore the background at the edges.
export function averageColor(data: Uint8ClampedArray, width: number, height: number): string {
  let hasTransparency = false
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 128) { hasTransparency = true; break }
  }

  const x0 = hasTransparency ? 0 : Math.floor(width * 0.3)
  const x1 = hasTransparency ? width : Math.ceil(width * 0.7)
  const y0 = hasTransparency ? 0 : Math.floor(height * 0.3)
  const y1 = hasTransparency ? height : Math.ceil(height * 0.7)

  let r = 0, g = 0, b = 0, n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 128) continue            // skip see-through pixels
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
    }
  }
  if (n === 0) return '#000000'
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0')
  return '#' + hex(r) + hex(g) + hex(b)
}

// Pure function: the most common color in the center of the picture.
// Averaging a printed or photographed garment gives a muddy brown, so this groups
// pixels into coarse color buckets and returns the mean of the biggest bucket instead.
export function dominantColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: {
    /** Favour saturated colors over light trim, e.g. a red kurta covered in cream embroidery. */
    preferColorful?: boolean
    /** Skip pixels close to this color (the photo background), so a narrow garment still wins. */
    ignore?: [number, number, number]
  } = {}
): string {
  const { preferColorful = false, ignore } = options
  const x0 = Math.floor(width * 0.25)
  const x1 = Math.ceil(width * 0.75)
  const y0 = Math.floor(height * 0.2)
  const y1 = Math.ceil(height * 0.8)

  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 128) continue
      const r = data[i], g = data[i + 1], b = data[i + 2]
      if (ignore && Math.abs(r - ignore[0]) + Math.abs(g - ignore[1]) + Math.abs(b - ignore[2]) < 45) continue
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
      const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 }
      bucket.r += r; bucket.g += g; bucket.b += b; bucket.n++
      buckets.set(key, bucket)
    }
  }

  const weight = (b: { r: number; g: number; b: number; n: number }) => {
    if (!preferColorful) return b.n
    const r = b.r / b.n, g = b.g / b.n, bl = b.b / b.n
    const max = Math.max(r, g, bl), min = Math.min(r, g, bl)
    const saturation = max === 0 ? 0 : (max - min) / max
    return b.n * (0.15 + saturation)
  }
  let best: { r: number; g: number; b: number; n: number } | null = null
  for (const bucket of buckets.values()) {
    if (!best || weight(bucket) > weight(best)) best = bucket
  }
  if (!best) return '#000000'
  const n = best.n
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0')
  return '#' + hex(best.r) + hex(best.g) + hex(best.b)
}

// Downloads a picture by URL and returns its dominant center color as hex.
/**
 * Main color of an image URL. `band` limits it to a horizontal slice given as fractions of
 * the height, e.g. { from: 0, to: 0.5 } for the upper half (the tunic of a two-piece outfit).
 * `ignoreBackground` leaves out the color found in the photo's corners.
 */
export async function detectDominantColorFromUrl(
  url: string,
  options: { band?: { from: number; to: number }; preferColorful?: boolean; ignoreBackground?: boolean } = {}
): Promise<string> {
  const { band = { from: 0, to: 1 }, preferColorful = false, ignoreBackground = false } = options
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load ${url}`)
  const bitmap = await createImageBitmap(await res.blob())
  const size = 80
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is not available')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  let ignore: [number, number, number] | undefined
  if (ignoreBackground) {
    // Average of the four corners, where product photos show their plain background.
    const px = [ctx.getImageData(1, 1, 1, 1), ctx.getImageData(w - 2, 1, 1, 1), ctx.getImageData(1, h - 2, 1, 1), ctx.getImageData(w - 2, h - 2, 1, 1)]
    const avg = (c: number) => Math.round(px.reduce((s, p) => s + p.data[c], 0) / px.length)
    ignore = [avg(0), avg(1), avg(2)]
  }
  const y0 = Math.floor(h * band.from)
  const bh = Math.max(1, Math.round(h * band.to) - y0)
  return dominantColor(ctx.getImageData(0, y0, w, bh).data, w, bh, { preferColorful, ignore })
}

// Reads the photo, shrinks it to a small size, and returns its main color as hex.
export async function detectMainColor(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const size = 100
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is not available')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return averageColor(ctx.getImageData(0, 0, w, h).data, w, h)
}

// ---------- 2. Background removal ----------

// Shrinks a big phone photo so background removal is faster and the upload is smaller.
async function shrink(file: Blob, max = 1024): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not resize the photo'))), 'image/png'))
}

// Returns a PNG with a transparent background.
// The library (and its AI model, tens of MB) is only downloaded the first time this is called.
export async function removePhotoBackground(
  file: Blob,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  const { removeBackground } = await import('@imgly/background-removal')
  const small = await shrink(file)
  return removeBackground(small, {
    output: { format: 'image/png' },
    progress: (_key: string, current: number, total: number) => {
      if (total > 0) onProgress?.(Math.round((current / total) * 100))
    },
  })
}
