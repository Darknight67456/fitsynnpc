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
