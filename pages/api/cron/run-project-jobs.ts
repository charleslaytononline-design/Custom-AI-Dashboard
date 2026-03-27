/**
 * Cron job dispatcher — runs every minute via Vercel Cron.
 * Picks up due project_cron_jobs and executes their functions.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const clientsDb = process.env.CLIENTS_SUPABASE_URL && process.env.CLIENTS_SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.CLIENTS_SUPABASE_URL, process.env.CLIENTS_SUPABASE_SERVICE_ROLE_KEY)
  : null

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Authenticate via cron secret
  const authHeader = req.headers.authorization || ''
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!clientsDb) return res.status(200).json({ message: 'No clients DB configured', ran: 0 })

  try {
    const now = new Date().toISOString()

    // Get due jobs (max 50 per cycle to prevent runaway)
    const { data: dueJobs } = await supabase
      .from('project_cron_jobs')
      .select('id, project_id, user_id, name, schedule, function_name, params, consecutive_failures')
      .eq('enabled', true)
      .lte('next_run_at', now)
      .order('next_run_at', { ascending: true })
      .limit(50)

    if (!dueJobs || dueJobs.length === 0) {
      return res.status(200).json({ message: 'No jobs due', ran: 0 })
    }

    let ran = 0
    let failed = 0

    for (const job of dueJobs) {
      try {
        // Load the function code
        const { data: func } = await supabase
          .from('project_functions')
          .select('code, enabled')
          .eq('project_id', job.project_id)
          .eq('name', job.function_name)
          .single()

        if (!func || !func.enabled) {
          // Function doesn't exist or is disabled — mark job as failed
          const newFailures = (job.consecutive_failures || 0) + 1
          await supabase.from('project_cron_jobs').update({
            consecutive_failures: newFailures,
            enabled: newFailures >= 10 ? false : true, // Disable after 10 failures
            last_run_at: now,
            next_run_at: calculateNextRun(job.schedule),
          }).eq('id', job.id)
          failed++
          continue
        }

        // Execute the function
        const schemaName = `proj_${job.project_id}`
        const db = {
          async select(table: string, limit = 100) {
            const { data } = await clientsDb.rpc('project_select', { p_schema: schemaName, p_table: table, p_limit: limit })
            return data || []
          },
          async insert(table: string, row: any) {
            const { data } = await clientsDb.rpc('project_insert', { p_schema: schemaName, p_table: table, p_data: row })
            return data
          },
          async update(table: string, id: string, row: any) {
            const { data } = await clientsDb.rpc('project_update', { p_schema: schemaName, p_table: table, p_id: id, p_data: row })
            return data
          },
          async remove(table: string, id: string) {
            const { data } = await clientsDb.rpc('project_delete', { p_schema: schemaName, p_table: table, p_id: id })
            return data
          },
        }

        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
        const fn = new AsyncFunction('params', 'db', 'console', func.code)
        const safeConsole = { log: () => {}, warn: () => {}, error: () => {} }

        await Promise.race([
          fn(job.params || {}, db, safeConsole),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10_000)),
        ])

        // Success — update job
        await supabase.from('project_cron_jobs').update({
          last_run_at: now,
          next_run_at: calculateNextRun(job.schedule),
          consecutive_failures: 0,
        }).eq('id', job.id)

        ran++

        // Log success
        supabase.from('platform_logs').insert({
          event_type: 'cron_execution',
          severity: 'info',
          message: `Cron ${job.name} executed for project ${job.project_id}`,
          metadata: { sourceFile: 'pages/api/cron/run-project-jobs.ts', projectId: job.project_id, userId: job.user_id, jobName: job.name, success: true },
        }).then(() => {}, () => {})

      } catch (err: any) {
        failed++
        const newFailures = (job.consecutive_failures || 0) + 1
        await supabase.from('project_cron_jobs').update({
          consecutive_failures: newFailures,
          enabled: newFailures >= 10 ? false : true,
          last_run_at: now,
          next_run_at: calculateNextRun(job.schedule),
        }).eq('id', job.id)

        supabase.from('platform_logs').insert({
          event_type: 'cron_execution',
          severity: 'error',
          message: `Cron ${job.name} failed: ${err.message?.slice(0, 200)}`,
          metadata: { sourceFile: 'pages/api/cron/run-project-jobs.ts', projectId: job.project_id, userId: job.user_id, jobName: job.name, success: false, failures: newFailures, stack: err.stack?.slice(0, 500) },
        }).then(() => {}, () => {})
      }
    }

    return res.status(200).json({ message: `Processed ${dueJobs.length} jobs`, ran, failed })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}

// Calculate the next run time from a cron expression.
// Simple implementation: adds 1 minute for every-N, 1 hour for hourly, etc.
function calculateNextRun(schedule: string): string {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return new Date(Date.now() + 3600_000).toISOString() // default 1hr

  const [minute, hour] = parts

  // Every N minutes
  if (minute.startsWith('*/')) {
    const interval = parseInt(minute.slice(2)) || 1
    return new Date(Date.now() + interval * 60_000).toISOString()
  }

  // Every hour at specific minute
  if (hour === '*' && /^\d+$/.test(minute)) {
    return new Date(Date.now() + 3600_000).toISOString()
  }

  // Daily or more complex — default to 24h
  return new Date(Date.now() + 86400_000).toISOString()
}
