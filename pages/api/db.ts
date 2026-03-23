import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const appDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const clientsDb = process.env.CLIENTS_SUPABASE_URL && process.env.CLIENTS_SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.CLIENTS_SUPABASE_URL, process.env.CLIENTS_SUPABASE_SERVICE_ROLE_KEY)
  : null

const TABLE_NAME_RE = /^[a-z][a-z0-9_]{0,49}$/

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!clientsDb) return res.status(503).json({ error: 'Clients database not configured' })

  const { projectId, table, action, data, filters, limit } = req.body

  if (!projectId || !table || !action) {
    return res.status(400).json({ error: 'projectId, table, and action are required' })
  }

  // Validate table name to prevent SQL injection
  if (!TABLE_NAME_RE.test(table)) {
    return res.status(400).json({ error: 'Invalid table name' })
  }

  // Verify project exists in App DB (proves the projectId is real)
  const { data: project } = await appDb.from('projects').select('id, user_id').eq('id', projectId).single()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const schemaName = `proj_${projectId}`
  const qualifiedTable = `${schemaName}.${table}`

  try {
    if (action === 'select') {
      const rowLimit = Math.min(Number(limit) || 500, 1000)
      const { data: rows, error } = await clientsDb
        .from(qualifiedTable)
        .select('*')
        .limit(rowLimit)
        .order('created_at', { ascending: false })
      if (error) return res.status(200).json({ error: error.message, data: [] })
      return res.status(200).json({ data: rows || [] })
    }

    if (action === 'insert') {
      if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data object required for insert' })

      // Enforce max_rows_per_table plan limit
      const { data: projectUser } = await appDb.from('profiles').select('plan_id').eq('id', project.user_id).single()
      if (projectUser?.plan_id) {
        const { data: plan } = await appDb.from('plans').select('max_rows_per_table').eq('id', projectUser.plan_id).single()
        if (plan?.max_rows_per_table) {
          const { count } = await clientsDb.from(qualifiedTable).select('*', { count: 'exact', head: true })
          if (count !== null && count >= plan.max_rows_per_table) {
            return res.status(200).json({ error: 'row_limit_reached', message: `Row limit of ${plan.max_rows_per_table} reached for this table. Upgrade your plan.` })
          }
        }
      }

      const { data: inserted, error } = await clientsDb.from(qualifiedTable).insert(data).select().single()
      if (error) return res.status(200).json({ error: error.message })
      return res.status(200).json({ data: inserted })
    }

    if (action === 'update') {
      if (!data?.id) return res.status(400).json({ error: 'data.id required for update' })
      const { id, ...updateFields } = data
      const { data: updated, error } = await clientsDb.from(qualifiedTable).update(updateFields).eq('id', id).select().single()
      if (error) return res.status(200).json({ error: error.message })
      return res.status(200).json({ data: updated })
    }

    if (action === 'delete') {
      if (!data?.id) return res.status(400).json({ error: 'data.id required for delete' })
      const { error } = await clientsDb.from(qualifiedTable).delete().eq('id', data.id)
      if (error) return res.status(200).json({ error: error.message })
      return res.status(200).json({ data: { deleted: true } })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
