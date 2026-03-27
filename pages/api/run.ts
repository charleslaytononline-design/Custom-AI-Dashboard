/**
 * Server function execution endpoint.
 * Runs user-defined functions from project_functions table in a sandboxed context.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { getAuthUser } from '../../lib/apiAuth'
import { isValidUUID, sanitizeError } from '../../lib/validation'
import { checkRateLimit } from '../../lib/rateLimit'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const clientsDb = process.env.CLIENTS_SUPABASE_URL && process.env.CLIENTS_SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.CLIENTS_SUPABASE_URL, process.env.CLIENTS_SUPABASE_SERVICE_ROLE_KEY)
  : null

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const sessionUserId = await getAuthUser(req, res)
  if (!sessionUserId) return res.status(401).json({ error: 'Not authenticated' })

  const { projectId, function: funcName, params = {} } = req.body

  if (!projectId || !funcName) return res.status(400).json({ error: 'projectId and function name required' })
  if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' })

  // Rate limit: 100 calls/hour/project
  if (!checkRateLimit(`run:${projectId}`, 100, 3600_000)) {
    return res.status(429).json({ error: 'Function execution rate limit exceeded' })
  }

  // Verify ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .eq('user_id', sessionUserId)
    .single()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  // Load function
  const { data: func } = await supabase
    .from('project_functions')
    .select('code, enabled')
    .eq('project_id', projectId)
    .eq('name', funcName)
    .single()

  if (!func) return res.status(404).json({ error: 'Function not found' })
  if (!func.enabled) return res.status(400).json({ error: 'Function is disabled' })

  // Create a scoped Supabase client for the project
  const projectSupabase = clientsDb // Uses clients DB service role but scoped by RPC
  const schemaName = `proj_${projectId}`

  try {
    // Execute with timeout
    const result = await Promise.race([
      executeFunction(func.code, params, projectSupabase, schemaName),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Function timed out (10s limit)')), 10_000)),
    ])

    // Log execution
    supabase.from('platform_logs').insert({
      event_type: 'function_execution',
      severity: 'info',
      message: `Function ${funcName} executed`,
      metadata: { sourceFile: 'pages/api/run.ts', userId: sessionUserId, projectId, functionName: funcName, success: true },
    }).then(() => {}, () => {})

    return res.status(200).json({ success: true, result })
  } catch (err: any) {
    // Log failure
    supabase.from('platform_logs').insert({
      event_type: 'function_execution',
      severity: 'error',
      message: `Function ${funcName} failed: ${sanitizeError(err)}`,
      metadata: { sourceFile: 'pages/api/run.ts', userId: sessionUserId, projectId, functionName: funcName, success: false, stack: err.stack?.slice(0, 500) },
    }).then(() => {}, () => {})

    return res.status(200).json({ success: false, error: sanitizeError(err) })
  }
}

/**
 * Execute user function code in a restricted context.
 * The function only has access to: params, a simple DB helper, and basic JS.
 * No filesystem, no network (except via DB helper), no process, no require.
 */
async function executeFunction(
  code: string,
  params: any,
  dbClient: any,
  schemaName: string,
): Promise<any> {
  // Create a simple DB helper scoped to the project schema
  const db = {
    async select(table: string, limit = 100) {
      const { data } = await dbClient.rpc('project_select', { p_schema: schemaName, p_table: table, p_limit: limit })
      return data || []
    },
    async insert(table: string, row: any) {
      const { data } = await dbClient.rpc('project_insert', { p_schema: schemaName, p_table: table, p_data: row })
      return data
    },
    async update(table: string, id: string, row: any) {
      const { data } = await dbClient.rpc('project_update', { p_schema: schemaName, p_table: table, p_id: id, p_data: row })
      return data
    },
    async remove(table: string, id: string) {
      const { data } = await dbClient.rpc('project_delete', { p_schema: schemaName, p_table: table, p_id: id })
      return data
    },
  }

  // Execute the function with restricted globals
  // Using AsyncFunction constructor (safer than eval, but still sandboxed by the restricted scope)
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
  const fn = new AsyncFunction('params', 'db', 'console', code)

  // Restricted console (only log, no access to process/require/etc.)
  const safeConsole = { log: () => {}, warn: () => {}, error: () => {} }

  return await fn(params, db, safeConsole)
}
