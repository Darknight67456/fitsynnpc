/**
 * Looks that include demo catalog or sample garments. Those items are not rows in
 * the user's clothing_items table, so these looks are kept in this browser only and
 * never written to Supabase. Looks made only of owned items still go to `outfits`.
 */
export interface DeviceLook {
  id: string
  item_ids: string[]
  created_at: string
}

const KEY = 'fitsync.deviceLooks.v1'
const MAX_LOOKS = 30

export function readDeviceLooks(): DeviceLook[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (l): l is DeviceLook =>
        typeof l === 'object' && l !== null && typeof l.id === 'string' && Array.isArray(l.item_ids)
    )
  } catch {
    return []
  }
}

function write(looks: DeviceLook[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(looks.slice(0, MAX_LOOKS)))
    return true
  } catch {
    return false
  }
}

/** Saves a look and returns the new list, or null if this browser blocks storage. */
export function addDeviceLook(itemIds: string[]): DeviceLook[] | null {
  const look: DeviceLook = {
    id: `device-${Date.now().toString(36)}`,
    item_ids: itemIds,
    created_at: new Date().toISOString(),
  }
  const next = [look, ...readDeviceLooks()]
  return write(next) ? next.slice(0, MAX_LOOKS) : null
}

export function removeDeviceLook(id: string): DeviceLook[] {
  const next = readDeviceLooks().filter(l => l.id !== id)
  write(next)
  return next
}
