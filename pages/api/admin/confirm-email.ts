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
  if (profile?.role !== 'admin') return res.status(403).json({ error: 'Not authorized' })

  const { userId } = req.body
  if (!userId) return res.status(400).json({ error: 'userId required' })

  // Force-confirm the email — bypasses email entirely
  const { error } = await adminSupabase.auth.admin.updateUserById(userId, {
    email_confirm: true,
  })

  if (error) return res.status(500).json({ error: error.message })

  res.json({ ok: true })
}
