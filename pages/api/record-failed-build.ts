import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { getAuthUser } from '../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  // Verify server-side session
  const sessionUserId = await getAuthUser(req, res)
  if (!sessionUserId) return res.status(401).json({ error: 'Not authenticated' })

  const { pageName, errorMessage, estimatedCost, continuationCount } = req.body
  const userId = sessionUserId

  // Only record if there's an actual cost to track
  const cost = parseFloat(estimatedCost) || 0
  if (cost <= 0) {
    return res.status(200).json({ ok: true, skipped: true })
  }

  try {
    await supabase.from('transactions').insert({
      user_id: userId,
      amount: 0,
      api_cost: cost,
      tokens_used: 0,
      type: 'failed',
      description: `Build failed (client-detected): ${pageName || 'unknown'} - ${(errorMessage || 'No terminal event received').slice(0, 80)}`,
    })

    // Also log to platform_logs for visibility
    await supabase.from('platform_logs').insert({
      event_type: 'builder_failed_untracked',
      severity: 'warn',
      message: `Client recorded untracked build failure: ${pageName} (cost: $${cost.toFixed(4)}, continuations: ${continuationCount || 0})`,
      metadata: { sourceFile: 'pages/api/record-failed-build.ts', userId, pageName, estimatedCost: cost, continuationCount, errorMessage },
    })
  } catch (err) {
    console.error('Failed to record build failure:', err)
    return res.status(500).json({ error: 'Failed to record' })
  }

  return res.status(200).json({ ok: true })
}
