import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const serverClient = createServerSupabaseClient({ req, res })
  const { data: { session } } = await serverClient.auth.getSession()
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  if (req.method === 'PUT') {
    const { theme_id } = req.body
    const { error } = await adminSupabase
      .from('profiles')
      .update({ theme_id: theme_id || null })
      .eq('id', session.user.id)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
