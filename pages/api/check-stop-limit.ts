import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  const { userId } = req.query
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Missing userId' })
  }

  try {
    // Get configurable limit from settings (default: 5)
    const { data: limitSetting } = await supabase
      .from('settings').select('value').eq('key', 'stop_limit_per_hour').single()
    const limit = parseInt(limitSetting?.value || '5', 10)

    // Count stopped transactions in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'stopped')
      .gte('created_at', oneHourAgo)

    const used = count || 0
    const allowed = used < limit

    return res.status(200).json({
      allowed,
      remaining: Math.max(0, limit - used),
      used,
      limit,
    })
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to check stop limit' })
  }
}
