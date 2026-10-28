import { supabase } from '../../lib/supabase'

const today = () => new Date().toLocaleDateString('en-CA')   // YYYY-MM-DD in the user's own time zone

// Logs today's wear for several items at once (skips an item already logged today),
// then recounts each item so wear_count and last_worn_at match the history.
export async function logWornToday(itemIds: string[]): Promise<string | null> {
  const day = today()
  for (const id of itemIds) {
    const have = await supabase.from('wear_log').select('id').eq('item_id', id).eq('worn_on', day)
    if (have.error) return have.error.message
    if (have.data.length === 0) {
      const ins = await supabase.from('wear_log').insert({ item_id: id, worn_on: day })
      if (ins.error) return ins.error.message
    }
    const all = await supabase.from('wear_log').select('worn_on').eq('item_id', id).order('worn_on', { ascending: false })
    if (all.error) return all.error.message
    const upd = await supabase.from('clothing_items')
      .update({ wear_count: all.data.length, last_worn_at: all.data[0]?.worn_on ?? null }).eq('id', id)
    if (upd.error) return upd.error.message
  }
  return null
}
