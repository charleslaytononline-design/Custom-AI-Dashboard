import { SupabaseClient } from '@supabase/supabase-js'

export interface PlanLimits {
  id: string
  name: string
  price_monthly: number
  ai_credits_monthly: number
  max_projects: number
  max_tables_per_project: number
  max_rows_per_table: number
  max_storage_mb: number
  can_connect_own_supabase: boolean
  max_builds_per_month: number
}

/**
 * Resolves the plan for a user. If plan_id is provided, fetches that plan.
 * If plan_id is null/undefined, fetches the Free plan (lowest price_monthly, first by sort_order).
 */
export async function getPlan(supabase: SupabaseClient, planId: string | null | undefined): Promise<PlanLimits | null> {
  if (planId) {
    const { data } = await supabase.from('plans').select('*').eq('id', planId).single()
    return data
  }
  // Fallback: get the Free plan
  const { data } = await supabase
    .from('plans')
    .select('*')
    .eq('price_monthly', 0)
    .order('sort_order', { ascending: true })
    .limit(1)
    .single()
  return data
}

/**
 * Resolves a user's plan by looking up their profile first, then their plan.
 * Returns null only if no plan exists at all in the database.
 */
export async function getUserPlan(supabase: SupabaseClient, userId: string): Promise<PlanLimits | null> {
  const { data: profile } = await supabase.from('profiles').select('plan_id').eq('id', userId).single()
  return getPlan(supabase, profile?.plan_id)
}
