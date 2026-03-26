import type { NextApiRequest, NextApiResponse } from 'next'
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'

/**
 * Extracts the authenticated user's ID from the server-side session.
 * Returns null if the user is not authenticated.
 *
 * Usage:
 *   const userId = await getAuthUser(req, res)
 *   if (!userId) return res.status(401).json({ error: 'Not authenticated' })
 */
export async function getAuthUser(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<string | null> {
  const serverClient = createServerSupabaseClient({ req, res })
  const { data: { session } } = await serverClient.auth.getSession()
  return session?.user?.id ?? null
}
