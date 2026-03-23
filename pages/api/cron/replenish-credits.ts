import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Monthly AI credit replenishment.
 * Called by Vercel Cron on the 1st of each month.
 * Protected by CRON_SECRET to prevent unauthorized access.
 *
 * For each plan with ai_credits_monthly > 0, adds that amount
 * to the credit_balance of every user on that plan.
 * Credits accumulate (added on top of existing balance).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Get all active plans with monthly credits
  const { data: plans, error: plansError } = await supabase
    .from('plans')
    .select('id, name, ai_credits_monthly')
    .gt('ai_credits_monthly', 0)
    .eq('is_active', true)

  if (plansError || !plans) {
    return res.status(500).json({ error: 'Failed to fetch plans', detail: plansError?.message })
  }

  let totalUsersUpdated = 0
  const results: { plan: string; users: number; creditsAdded: number }[] = []

  for (const plan of plans) {
    // For the free plan, also include null plan_id users
    const { data: planDetails } = await supabase.from('plans').select('price_monthly').eq('id', plan.id).single()
    let users: { id: string }[] | null = null

    if (planDetails?.price_monthly === 0) {
      const { data: assigned } = await supabase.from('profiles').select('id').eq('plan_id', plan.id)
      const { data: unassigned } = await supabase.from('profiles').select('id').is('plan_id', null)
      users = [...(assigned || []), ...(unassigned || [])]
    } else {
      const { data } = await supabase.from('profiles').select('id').eq('plan_id', plan.id)
      users = data
    }

    if (users && users.length > 0) {
      for (const user of users) {
        await supabase.rpc('add_credits', {
          p_user_id: user.id,
          p_amount: plan.ai_credits_monthly,
          p_type: 'monthly_replenish',
          p_description: `Monthly credit replenishment (${plan.name} plan)`,
          p_stripe_payment_id: null,
        })
      }
      totalUsersUpdated += users.length
      results.push({ plan: plan.name, users: users.length, creditsAdded: plan.ai_credits_monthly })
    }
  }

  // Log the replenishment
  await supabase.from('platform_logs').insert({
    event_type: 'credits_replenished',
    severity: 'info',
    message: `Monthly credit replenishment complete: ${totalUsersUpdated} users updated`,
    metadata: { results, timestamp: new Date().toISOString() },
  })

  // Update last replenishment timestamp
  await supabase.from('settings').upsert(
    { key: 'last_credit_replenish', value: new Date().toISOString() },
    { onConflict: 'key' }
  )

  return res.json({ ok: true, totalUsersUpdated, results })
}
