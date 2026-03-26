import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { getAuthUser } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Sets platform DB credentials on a project record.
 * Called when user chooses "Use our secure server" or to backfill existing projects.
 * Reads CLIENTS_SUPABASE_URL and CLIENTS_SUPABASE_ANON_KEY from server env.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const sessionUserId = await getAuthUser(req, res)
  if (!sessionUserId) return res.status(401).json({ error: 'Not authenticated' })

  const { projectId } = req.body
  if (!projectId) return res.status(400).json({ error: 'projectId required' })

  // Verify ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', sessionUserId)
    .single()

  if (!project) return res.status(403).json({ error: 'Project not found' })

  const clientsUrl = process.env.CLIENTS_SUPABASE_URL
  const clientsAnonKey = process.env.CLIENTS_SUPABASE_ANON_KEY

  if (!clientsUrl || !clientsAnonKey) {
    return res.status(503).json({ error: 'Platform database not configured' })
  }

  const { error } = await supabase
    .from('projects')
    .update({
      db_provider: 'platform',
      supabase_url: clientsUrl,
      supabase_anon_key: clientsAnonKey,
    })
    .eq('id', projectId)
    .eq('user_id', sessionUserId)

  if (error) return res.status(500).json({ error: error.message })

  res.status(200).json({ url: clientsUrl, anonKey: clientsAnonKey })
}
