import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { BodyProfile } from '../../types'

export const DEFAULT_PROFILE: BodyProfile = {
  user_id: '',
  height_cm: 165,
  weight_kg: 58,
  chest: 88,
  waist: 72,
  hips: 96,
  shoulder: 38,
  fit_pref: 'regular',
  skin_undertone: 'neutral',
}

export function useBodyProfile() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<BodyProfile>(DEFAULT_PROFILE)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from('body_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (data) setProfile(data as BodyProfile)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  // returns an error message, or '' when it worked
  async function save(p: BodyProfile): Promise<string> {
    if (!user) return 'Not logged in.'
    const { error } = await supabase
      .from('body_profiles')
      .upsert({ ...p, user_id: user.id }, { onConflict: 'user_id' })
    return error ? error.message : ''
  }

  return { profile, setProfile, loading, save }
}
