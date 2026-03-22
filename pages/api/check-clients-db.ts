import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  const url = process.env.CLIENTS_SUPABASE_URL
  const key = process.env.CLIENTS_SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    return res.status(200).json({ connected: false, reason: 'env_missing' })
  }

  try {
    const client = createClient(url, key)
    const { error } = await client.from('schema_registry').select('id').limit(1)
    if (error) return res.status(200).json({ connected: false, reason: error.message })
    return res.status(200).json({ connected: true })
  } catch (err: any) {
    return res.status(200).json({ connected: false, reason: err.message })
  }
}
