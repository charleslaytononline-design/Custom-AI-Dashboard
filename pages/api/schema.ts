/**
 * API endpoint to fetch database schema for a project.
 * Returns tables, columns, and types from the project's schema in the clients DB.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { isValidUUID, sanitizeError } from '../../lib/validation'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { projectId } = req.query
  if (!projectId || typeof projectId !== 'string') return res.status(400).json({ error: 'Missing projectId' })

  // SECURITY: validate projectId UUID format
  if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' })

  // Auth check
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies['sb-access-token']
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  // Verify project ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  // Connect to clients DB
  const clientsUrl = process.env.CLIENTS_SUPABASE_URL
  const clientsKey = process.env.CLIENTS_SUPABASE_SERVICE_ROLE_KEY
  if (!clientsUrl || !clientsKey) {
    return res.status(200).json({ tables: [], message: 'No clients database configured' })
  }

  const clientsDb = createClient(clientsUrl, clientsKey)
  const schemaName = `proj_${projectId}`

  try {
    // Query information_schema for the project's tables and columns
    const { data, error } = await clientsDb.rpc('get_schema_info', { schema_name: schemaName })

    if (error) {
      // Fallback: query information_schema directly
      const { data: columns, error: colErr } = await clientsDb
        .from('information_schema.columns')
        .select('table_name, column_name, data_type, is_nullable, column_default')
        .eq('table_schema', schemaName)
        .order('table_name')
        .order('ordinal_position')

      if (colErr) return res.status(200).json({ tables: [] })

      // Group by table
      const tables: Record<string, Array<{ name: string; type: string; nullable: boolean; default: string | null }>> = {}
      for (const col of columns || []) {
        if (!tables[col.table_name]) tables[col.table_name] = []
        tables[col.table_name].push({
          name: col.column_name,
          type: col.data_type,
          nullable: col.is_nullable === 'YES',
          default: col.column_default,
        })
      }

      return res.status(200).json({
        tables: Object.entries(tables).map(([name, columns]) => ({ name, columns })),
      })
    }

    return res.status(200).json({ tables: data || [] })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
