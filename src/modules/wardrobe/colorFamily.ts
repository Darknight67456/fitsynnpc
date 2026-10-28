export const COLOR_NAMES = [
  'black', 'white', 'gray', 'beige', 'brown', 'red', 'orange', 'yellow',
  'green', 'blue', 'navy', 'purple', 'pink',
] as const

// Turns a hex color into an everyday color name.
export function colorName(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16)
  if (Number.isNaN(n)) return 'gray'
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2, d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))

  if (l < 0.13) return 'black'
  if (l > 0.93 && s < 0.4) return 'white'
  if (s < 0.12) return l > 0.85 ? 'white' : 'gray'

  const h6 = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  const h = (h6 * 60 + 360) % 360

  // warm, low-saturation or dark-orange colors are beige / brown
  if (h >= 15 && h < 50 && s < 0.45 && l > 0.6) return 'beige'
  if (h >= 10 && h < 50 && l < 0.4) return 'brown'
  if (h >= 10 && h < 50 && s < 0.5) return l > 0.55 ? 'beige' : 'brown'

  if (h < 12 || h >= 345) return l > 0.78 ? 'pink' : 'red'
  if (h < 45) return 'orange'
  if (h < 70) return 'yellow'
  if (h < 165) return 'green'
  if (h < 255) return l < 0.3 ? 'navy' : 'blue'
  if (h < 290) return 'purple'
  return 'pink'
}

// Kept so older code that imports colorFamily keeps working.
export const colorFamily = colorName
