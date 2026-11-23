import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { addDeviceLook, readDeviceLooks, removeDeviceLook, type DeviceLook } from './deviceLooks'

interface AccountLookRow {
  id: string
  item_ids: string[]
  occasion: string | null
  created_at: string
}

export interface SavedLook {
  id: string
  item_ids: string[]
  created_at: string
  occasion?: string | null
  /** 'account' looks are rows in Supabase `outfits`; 'device' looks stay in this browser. */
  where: 'account' | 'device'
}

/** Saved looks from the user's account and this browser, newest first. */
export function useSavedLooks() {
  const [accountLooks, setAccountLooks] = useState<AccountLookRow[]>([])
  const [deviceLooks, setDeviceLooks] = useState<DeviceLook[]>(() => readDeviceLooks())
  const [loading, setLoading] = useState(true)

  const fetchAccountLooks = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('outfits')
      .select('id, item_ids, occasion, created_at')
      .order('created_at', { ascending: false })
      .limit(30)
    if (!error && data) setAccountLooks(data as AccountLookRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    // Loading on mount is the intended side effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAccountLooks()
  }, [fetchAccountLooks])

  const looks: SavedLook[] = useMemo(
    () =>
      [
        ...accountLooks.map(l => ({ ...l, where: 'account' as const })),
        ...deviceLooks.map(l => ({ ...l, where: 'device' as const })),
      ].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [accountLooks, deviceLooks]
  )

  /**
   * Saves a look. Looks made only of the user's own wardrobe go to their account;
   * anything with catalog items stays on this device. Returns a message for the UI.
   */
  async function saveLook(itemIds: string[], allOwned: boolean): Promise<{ ok: boolean; message: string }> {
    if (allOwned) {
      const { error } = await supabase.from('outfits').insert({ item_ids: itemIds })
      if (error) return { ok: false, message: `Could not save the look: ${error.message}` }
      void fetchAccountLooks()
      return { ok: true, message: 'Look saved to your account. Find it under Outfits → Saved looks.' }
    }
    const next = addDeviceLook(itemIds)
    if (!next) return { ok: false, message: 'This browser is blocking storage, so the look could not be saved.' }
    setDeviceLooks(next)
    return { ok: true, message: 'Look saved on this device. Find it under Outfits → Saved looks.' }
  }

  async function deleteLook(look: SavedLook): Promise<string> {
    if (look.where === 'device') {
      setDeviceLooks(removeDeviceLook(look.id))
      return ''
    }
    const { error } = await supabase.from('outfits').delete().eq('id', look.id)
    if (error) return `Could not remove the look: ${error.message}`
    setAccountLooks(prev => prev.filter(l => l.id !== look.id))
    return ''
  }

  return { looks, loading, saveLook, deleteLook }
}
