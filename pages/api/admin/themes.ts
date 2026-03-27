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
      .from('color_themes')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ themes: data })
  }

  if (req.method === 'POST') {
    const { name, colors, is_available, sort_order } = req.body
    if (!name || !colors) return res.status(400).json({ error: 'name and colors required' })
    const { data, error } = await adminSupabase
      .from('color_themes')
      .insert({ name, colors, is_available: is_available ?? true, sort_order: sort_order ?? 0 })
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ theme: data })
  }

  if (req.method === 'PUT') {
    const { id, name, colors, is_available, sort_order } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updates.name = name
    if (colors !== undefined) updates.colors = colors
    if (is_available !== undefined) updates.is_available = is_available
    if (sort_order !== undefined) updates.sort_order = sort_order
    const { data, error } = await adminSupabase
      .from('color_themes')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ theme: data })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    // Prevent deleting built-in themes
    const { data: theme } = await adminSupabase.from('color_themes').select('is_builtin').eq('id', id).single()
    if (theme?.is_builtin) return res.status(400).json({ error: 'Cannot delete built-in themes' })
    const { error } = await adminSupabase.from('color_themes').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
