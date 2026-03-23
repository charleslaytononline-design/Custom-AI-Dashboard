import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  // Verify admin
  const serverClient = createServerSupabaseClient({ req, res })
  const { data: { session } } = await serverClient.auth.getSession()
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  const { data: profile } = await adminSupabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' })
  }

  // Find the Free plan
  const { data: freePlan } = await adminSupabase
    .from('plans')
    .select('id, name')
    .eq('price_monthly', 0)
    .order('sort_order', { ascending: true })
    .limit(1)
    .single()

  if (!freePlan) {
    return res.status(404).json({ error: 'No free plan found (price_monthly = 0)' })
  }

  // Update all profiles with null plan_id
  const { data: updated, error } = await adminSupabase
    .from('profiles')
    .update({ plan_id: freePlan.id })
    .is('plan_id', null)
    .select('id')

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  return res.json({
    ok: true,
    freePlanId: freePlan.id,
    freePlanName: freePlan.name,
    usersUpdated: updated?.length || 0,
  })
}
