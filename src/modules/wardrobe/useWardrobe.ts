import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { ClothingItem } from '../../types'

export function useWardrobe() {
  const [items, setItems] = useState<ClothingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)          // change this number to reload the list

  useEffect(() => {
    let cancelled = false
    supabase
      .from('clothing_items')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error.message)
        else setItems(data as ClothingItem[])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [tick])

  const reload = useCallback(() => setTick(t => t + 1), [])

  return { items, loading, error, reload }
}
