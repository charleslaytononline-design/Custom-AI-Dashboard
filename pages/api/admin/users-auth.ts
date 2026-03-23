import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  // Verify the caller is an admin
  const serverClient = createServerSupabaseClient({ req, res })
  const { data: { session } } = await serverClient.auth.getSession()
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  const { data: profile } = await adminSupabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single()
  if (profile?.role !== 'admin') return res.status(403).json({ error: 'Not authorized' })

  // Fetch all users from auth.users via admin API
  const { data, error } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
  if (error) return res.status(500).json({ error: error.message })

  const users = data.users.map((u: any) => ({
    id: u.id,
    email: u.email,
    email_confirmed_at: u.email_confirmed_at || null,
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at || null,
  }))

  res.json({ users })
}
