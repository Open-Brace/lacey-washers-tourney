import { createClient } from '@supabase/supabase-js'
import type { TournamentState } from './tournament'

export const tournamentId = 'graduation-washers'
export const tableName = 'tournament_states'

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://arlubjnwvjqvcufkshjd.supabase.co'
const supabaseKey =
  import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_UNGFBhJfRF9D_lGrAClucQ_bjU6sJQs'

export const supabase = createClient(supabaseUrl, supabaseKey)

export type TournamentRow = {
  id: string
  state: TournamentState
  updated_at: string
}
