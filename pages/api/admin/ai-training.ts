import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function verifyAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  const serverClient = createServerSupabaseClient({ req, res })
  const { data: { session } } = await serverClient.auth.getSession()
  if (!session) { res.status(401).json({ error: 'Not authenticated' }); return false }
  const { data: profile } = await adminSupabase.from('profiles').select('role').eq('id', session.user.id).single()
  if (!profile || !['admin', 'super_admin'].includes(profile.role)) { res.status(403).json({ error: 'Not authorized' }); return false }
  return true
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await verifyAdmin(req, res))) return

  if (req.method === 'GET') {
    const { data, error } = await adminSupabase
      .from('ai_training_rules')
      .select('*')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ rules: data })
  }

  if (req.method === 'POST') {
    const { type, keywords, instructions, enabled, priority } = req.body
    if (!type || !instructions) return res.status(400).json({ error: 'type and instructions required' })
    const { data, error } = await adminSupabase
      .from('ai_training_rules')
      .insert({ type, keywords: keywords || null, instructions, enabled: enabled ?? true, priority: priority ?? 0 })
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ rule: data })
  }

  if (req.method === 'PUT') {
    const { id, ...updates } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const { data, error } = await adminSupabase
      .from('ai_training_rules')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ rule: data })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await adminSupabase.from('ai_training_rules').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  res.status(405).end()
}
