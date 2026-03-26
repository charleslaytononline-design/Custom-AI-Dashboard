import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { getAuthUser } from '../../lib/apiAuth'
import { isValidUUID, isValidTableName, sanitizeError } from '../../lib/validation'
import { checkRateLimit } from '../../lib/rateLimit'

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
  if (!clientsDb) return res.status(503).json({ success: false, error: 'Clients database not configured' })

  // Verify server-side session
  const sessionUserId = await getAuthUser(req, res)
  if (!sessionUserId) return res.status(401).json({ success: false, error: 'Not authenticated' })

  // SECURITY: rate limit — max 60 DB operations per minute per user
  if (!checkRateLimit(`db:${sessionUserId}`, 60, 60_000)) {
    return res.status(429).json({ success: false, error: 'Too many database requests. Please slow down.' })
  }

  const { projectId, table, action, data, limit } = req.body

  if (!projectId || !table || !action) {
    return res.status(400).json({ success: false, error: 'projectId, table, and action are required' })
  }

  // SECURITY: validate projectId UUID format
  if (!isValidUUID(projectId)) {
    return res.status(400).json({ success: false, error: 'Invalid project ID' })
  }

  // Validate table name to prevent SQL injection
  if (!isValidTableName(table)) {
    return res.status(400).json({ success: false, error: 'Invalid table name' })
  }

  // Verify project exists AND the authenticated user owns it
  const { data: project } = await appDb.from('projects').select('id, user_id').eq('id', projectId).eq('user_id', sessionUserId).single()
  if (!project) return res.status(403).json({ success: false, error: 'Project not found or access denied' })

  const schemaName = `proj_${projectId}`

  try {
    if (action === 'select') {
      const rowLimit = Math.min(Number(limit) || 500, 1000)
      const { data: result, error } = await clientsDb.rpc('project_select', {
        p_schema: schemaName,
        p_table: table,
        p_limit: rowLimit,
      })
      if (error) return res.status(200).json({ success: false, error: sanitizeError(error), data: [] })
      return res.status(200).json({ success: true, data: result || [] })
    }

    if (action === 'insert') {
      if (!data || typeof data !== 'object') return res.status(400).json({ success: false, error: 'data object required for insert' })

      // Enforce max_rows_per_table plan limit (resolves Free plan for null plan_id)
      const { data: projectUser } = await appDb.from('profiles').select('plan_id').eq('id', project.user_id).single()
      const userPlanId = projectUser?.plan_id || null
      const { data: plan } = userPlanId
        ? await appDb.from('plans').select('max_rows_per_table').eq('id', userPlanId).single()
        : await appDb.from('plans').select('max_rows_per_table').eq('price_monthly', 0).order('sort_order', { ascending: true }).limit(1).single()
      if (plan?.max_rows_per_table) {
        const { data: count } = await clientsDb.rpc('project_count', { p_schema: schemaName, p_table: table })
        if (count !== null && count >= plan.max_rows_per_table) {
          return res.status(200).json({ success: false, error: 'row_limit_reached', message: `Row limit of ${plan.max_rows_per_table} reached for this table. Upgrade your plan.` })
        }
      }

      const { data: result, error } = await clientsDb.rpc('project_insert', {
        p_schema: schemaName,
        p_table: table,
        p_data: data,
      })
      if (error) return res.status(200).json({ success: false, error: sanitizeError(error) })
      // Audit log: insert
      appDb.from('platform_logs').insert({ event_type: 'db_mutation', severity: 'info', message: `insert on ${table}`, metadata: { userId: sessionUserId, projectId, table, action: 'insert' } }).then(() => {}, () => {})
      return res.status(200).json({ success: true, data: result })
    }

    if (action === 'update') {
      if (!data?.id) return res.status(400).json({ success: false, error: 'data.id required for update' })
      const { id, ...updateFields } = data
      const { data: result, error } = await clientsDb.rpc('project_update', {
        p_schema: schemaName,
        p_table: table,
        p_id: id,
        p_data: updateFields,
      })
      if (error) return res.status(200).json({ success: false, error: sanitizeError(error) })
      // Audit log: update
      appDb.from('platform_logs').insert({ event_type: 'db_mutation', severity: 'info', message: `update on ${table}`, metadata: { userId: sessionUserId, projectId, table, action: 'update', rowId: id } }).then(() => {}, () => {})
      return res.status(200).json({ success: true, data: result })
    }

    if (action === 'delete') {
      if (!data?.id) return res.status(400).json({ success: false, error: 'data.id required for delete' })
      const { data: result, error } = await clientsDb.rpc('project_delete', {
        p_schema: schemaName,
        p_table: table,
        p_id: data.id,
      })
      if (error) return res.status(200).json({ success: false, error: sanitizeError(error) })
      // Audit log: delete
      appDb.from('platform_logs').insert({ event_type: 'db_mutation', severity: 'info', message: `delete on ${table}`, metadata: { userId: sessionUserId, projectId, table, action: 'delete', rowId: data.id } }).then(() => {}, () => {})
      return res.status(200).json({ success: true, data: { deleted: result } })
    }

    return res.status(400).json({ success: false, error: `Unknown action: ${action}` })
  } catch (err: any) {
    return res.status(500).json({ success: false, error: sanitizeError(err) })
  }
}
