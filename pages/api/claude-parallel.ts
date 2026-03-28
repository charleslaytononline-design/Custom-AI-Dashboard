/**
 * Parallel build API endpoint.
 *
 * Orchestrates: plan call → layered parallel file generation → App.tsx final call.
 * Maintains a single SSE connection to the frontend while spawning multiple
 * Claude API calls in parallel for each dependency layer.
 *
 * Falls back to single-call mode (redirect to /api/claude) when the plan
 * determines the task is small enough.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import Anthropic from '@anthropic-ai/sdk'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { getAuthUser } from '../../lib/apiAuth'
import { loadProjectFiles, saveFile } from '../../lib/virtualFS'
import { compactReactHistory } from '../../lib/reactContextManager'
import { checkRateLimit } from '../../lib/rateLimit'
import { isValidUUID, isValidFilePath, isValidTableName, validateTableDef, sanitizeTrainingRule, isSafeDefaultValue } from '../../lib/validation'
import {
  buildParallelPlanPrompt,
  buildSingleFilePrompt,
  buildAppTsxPrompt,
  type PlanManifest,
  type PlanFile,
} from '../../lib/parallelPlanPrompt'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const clientsDb = process.env.CLIENTS_SUPABASE_URL && process.env.CLIENTS_SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.CLIENTS_SUPABASE_URL, process.env.CLIENTS_SUPABASE_SERVICE_ROLE_KEY)
  : null

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
  maxDuration: 300,
  responseLimit: false,
}

// ── Helpers ────────────────────────────────────────────────────────

async function log(
  event_type: string, severity: 'info' | 'warn' | 'error',
  message: string, email?: string | null, metadata?: Record<string, unknown>,
) {
  try {
    const fingerprint = crypto.createHash('md5').update(`${event_type}:${(message || '').slice(0, 100)}`).digest('hex')
    await supabase.from('platform_logs').insert({ event_type, severity, message, email: email || null, metadata: metadata || null, fingerprint })
  } catch { /* don't let logging failures break the main flow */ }
}

async function getSettings() {
  const { data } = await supabase.from('settings').select('*')
  const map: Record<string, string> = {}
  data?.forEach((s: any) => { map[s.key] = s.value })
  return {
    markupMultiplier: parseFloat(map['markup_multiplier']) || 3.0,
    inputCostPer1k: parseFloat(map['input_cost_per_1k']) || 0.003,
    outputCostPer1k: parseFloat(map['output_cost_per_1k']) || 0.015,
    chatModel: map['ai_chat_model'] || 'claude-sonnet-4-5',
  }
}

async function getTrainingRules(userMessage: string) {
  const { data: rules } = await supabase
    .from('ai_training_rules').select('*').eq('enabled', true).order('priority', { ascending: false })
  if (!rules || rules.length === 0) return ''
  const matched: string[] = []
  const msg = userMessage.toLowerCase()
  for (const rule of rules) {
    if (rule.type === 'global') matched.push(sanitizeTrainingRule(rule.instructions))
    else if (rule.type === 'keyword' && rule.keywords) {
      const keywords = rule.keywords.split(',').map((k: string) => k.trim().toLowerCase())
      if (keywords.some((kw: string) => kw && msg.includes(kw))) matched.push(sanitizeTrainingRule(rule.instructions))
    }
  }
  if (matched.length === 0) return ''
  return '\n\nAI TRAINING RULES:\n' + matched.map((m, i) => `${i + 1}. ${m}`).join('\n')
}

/** Extract export signatures from generated code for contract passing */
function extractContracts(code: string): string {
  const lines = code.split('\n')
  const exports: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Capture full interface/type blocks (multi-line)
    if (trimmed.startsWith('export interface ') || trimmed.startsWith('export type ')) {
      let braceCount = 0
      let inBlock = false
      let block = ''
      for (let j = i; j < lines.length; j++) {
        block += (j > i ? '\n' : '') + lines[j]
        for (const ch of lines[j]) {
          if (ch === '{') { braceCount++; inBlock = true }
          if (ch === '}') braceCount--
        }
        if (inBlock && braceCount === 0) break
        // Single-line type alias (no braces, e.g. `export type X = string`)
        if (!inBlock && j > i) break
      }
      exports.push(block.trim())
    }
    // Capture function/const export signatures — handle multi-line parameter lists
    else if (
      trimmed.startsWith('export function ') ||
      trimmed.startsWith('export const ') ||
      trimmed.startsWith('export default function ') ||
      trimmed.startsWith('export default class ')
    ) {
      let sig = ''
      for (let j = i; j < lines.length && j < i + 10; j++) {
        sig += (j > i ? '\n' : '') + lines[j]
        // Stop at the function body opening brace or arrow
        if (/(?:=>|^\s*\{|>\s*\{|\)\s*\{|\):\s*\w.*\{)/.test(lines[j]) && j > i) {
          sig = sig.replace(/\s*(?:=>|{)\s*(?:[\s\S]*)$/, '')
          break
        }
        if (j === i && /\{[\s\S]*$/.test(lines[j])) {
          sig = sig.replace(/\s*\{[\s\S]*$/, '')
          break
        }
      }
      exports.push(sig.trim())
    }
  }

  return exports.join('\n\n')
}

// ── Main Handler ──────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const SAFE_DURATION_MS = 270_000
  const handlerStart = Date.now()

  const sessionUserId = await getAuthUser(req, res)
  if (!sessionUserId) return res.status(401).json({ error: 'Not authenticated' })

  const { messages, projectId, activeFilePath } = req.body
  const userId = sessionUserId

  if (projectId && !isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' })
  if (!checkRateLimit(`build:${userId}`, 10, 60_000)) return res.status(429).json({ error: 'Rate limit exceeded.' })

  // Load user profile + balance
  const { data: profile } = await supabase.from('profiles').select('email, credit_balance, gift_balance, plan_id').eq('id', userId).single()
  if (!profile) return res.status(404).json({ error: 'Profile not found' })
  const totalBalance = (profile.credit_balance || 0) + (profile.gift_balance || 0)
  if (totalBalance <= 0) return res.status(402).json({ error: 'Insufficient credits' })

  const userEmail = profile.email
  const settings = await getSettings()

  // Load project
  let projectName = ''
  let dbProvider: string | null = null
  if (projectId) {
    const { data: proj } = await supabase.from('projects').select('name, db_provider').eq('id', projectId).eq('user_id', userId).single()
    projectName = proj?.name || ''
    dbProvider = proj?.db_provider || null
  }

  const reactFiles = projectId ? await loadProjectFiles(projectId, supabase) : []

  const userMessage = messages?.[messages.length - 1]?.content || ''
  const trainingRules = await getTrainingRules(typeof userMessage === 'string' ? userMessage : '')

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.status(200)

  let clientDisconnected = false
  res.on('close', () => { clientDisconnected = true })

  function sendSSE(data: object) {
    if (clientDisconnected) return
    try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch {}
  }

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n') } catch {}
  }, 5000)

  let totalInputTokens = 0
  let totalOutputTokens = 0

  try {
    // ── STEP 1: Plan call ──────────────────────────────────────
    sendSSE({ type: 'status', text: 'Planning build...' })

    const planPrompt = buildParallelPlanPrompt({
      projectName, projectId: projectId || '', allFiles: reactFiles,
      userPrompt: typeof userMessage === 'string' ? userMessage : '',
      hasClientsDb: !!clientsDb,
    })

    // Compact conversation history for context (Bug 8)
    const rawHistory = (messages || []).slice(0, -1).map((m: any) => ({ role: m.role, content: m.content }))
    const { summary, recentMessages } = compactReactHistory(rawHistory, 4)
    const firstUserIdx = recentMessages.findIndex((m: any) => m.role === 'user')
    const safeHistory = firstUserIdx > 0 ? recentMessages.slice(firstUserIdx) : recentMessages
    const contextualPlanPrompt = summary
      ? planPrompt + trainingRules + `\n\nCONVERSATION CONTEXT:\n${summary}`
      : planPrompt + trainingRules

    const planMessages = [
      ...safeHistory,
      { role: 'user' as const, content: typeof userMessage === 'string' ? userMessage : 'Build this project' },
    ]

    const planResponse = await client.messages.create({
      model: settings.chatModel,
      max_tokens: 4000,
      system: contextualPlanPrompt,
      messages: planMessages,
    })

    totalInputTokens += planResponse.usage.input_tokens
    totalOutputTokens += planResponse.usage.output_tokens

    const planText = planResponse.content[0]?.type === 'text' ? planResponse.content[0].text : ''

    // Parse plan JSON — strip markdown fences if present
    let plan: PlanManifest
    try {
      const cleaned = planText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
      plan = JSON.parse(cleaned)
    } catch (parseErr) {
      await log('parallel_plan_error', 'warn', 'Plan JSON parse failed, redirecting to single mode', userEmail, {
        planText: planText.slice(0, 500), error: (parseErr as Error).message,
      })
      sendSSE({ type: 'redirect', target: 'single' })
      clearInterval(heartbeat)
      res.end()
      return
    }

    // Validate all file paths in plan before processing
    plan.files = plan.files.filter(f => {
      if (!isValidFilePath(f.path)) {
        log('parallel_plan_warn', 'warn', `Plan contained invalid path: ${f.path}`, userEmail)
        return false
      }
      return true
    })

    // Redirect to single mode if plan says so
    if (plan.mode === 'single' || !plan.files || plan.files.length <= 2) {
      sendSSE({ type: 'redirect', target: 'single' })
      clearInterval(heartbeat)
      res.end()
      return
    }

    // Send plan to frontend
    sendSSE({ type: 'plan', plan })
    sendSSE({ type: 'status', text: `Plan ready: ${plan.files.length} files across ${Math.max(...plan.files.map(f => f.layer)) + 1} layers` })

    // ── STEP 2: Create database tables (if any) ────────────────
    // If tables are needed but user hasn't chosen a database provider yet, ask them
    if (plan.tables && plan.tables.length > 0 && projectId && !dbProvider) {
      const pendingTables = plan.tables.map(t => t.name)
      sendSSE({ type: 'db_choice_required', pendingTables })
      sendSSE({ type: 'done', message: 'Please choose where to store your data, then I\'ll create the tables.' })
      clearInterval(heartbeat)
      res.end()
      return
    }

    if (plan.tables && plan.tables.length > 0 && clientsDb && projectId) {
      sendSSE({ type: 'status', text: `Creating ${plan.tables.length} database table(s)...` })
      const schemaName = `proj_${projectId}`
      let tablesCreated = 0

      for (const table of plan.tables) {
        if (!isValidTableName(table.name)) continue
        // Auto-fix defaults the AI may generate as wrong types (match claude.ts behavior)
        for (const col of table.columns || []) {
          if (col.default === undefined || col.default === null) continue
          if (typeof col.default === 'boolean') col.default = String(col.default)
          if (typeof col.default === 'number' && Number.isFinite(col.default)) col.default = String(col.default)
          if (typeof col.default === 'string' &&
              !isSafeDefaultValue(col.default) &&
              /^[a-zA-Z][a-zA-Z0-9_ ]{0,98}$/.test(col.default)) {
            col.default = `'${col.default}'`
          }
        }
        const validationResult = validateTableDef(table)
        if (!validationResult.valid) {
          await log('parallel_table_error', 'warn', `Invalid table def: ${(validationResult as any).error || 'unknown'}`, userEmail)
          continue
        }
        try {
          await clientsDb.rpc('create_project_table', {
            schema_name: schemaName,
            table_def: { name: table.name, columns: table.columns },
          })
          tablesCreated++
          sendSSE({ type: 'status', text: `Created table: ${table.name}` })
        } catch (err: any) {
          await log('parallel_table_error', 'warn', `Table creation failed: ${table.name}: ${err.message}`, userEmail)
        }
      }

      // Track schema usage (same as claude.ts)
      if (tablesCreated > 0) {
        try {
          await Promise.all([
            clientsDb.from('schema_registry').upsert(
              { project_id: projectId, user_id: userId, schema_name: schemaName, last_accessed_at: new Date().toISOString() },
              { onConflict: 'project_id' }
            ),
            clientsDb.from('schema_usage').upsert(
              { project_id: projectId, user_id: userId, schema_name: schemaName, table_count: tablesCreated, sampled_at: new Date().toISOString() },
              { onConflict: 'project_id' }
            ),
          ])
        } catch {}
      }
    }

    // ── STEP 3: Generate files layer by layer ──────────────────
    const layers = new Map<number, PlanFile[]>()
    for (const file of plan.files) {
      const layer = file.layer ?? 0
      if (!layers.has(layer)) layers.set(layer, [])
      layers.get(layer)!.push(file)
    }

    const sortedLayers: Array<[number, PlanFile[]]> = []
    layers.forEach((files, layer) => sortedLayers.push([layer, files]))
    sortedLayers.sort((a, b) => a[0] - b[0])
    const generatedFiles: Record<string, string> = {} // path → content
    const contracts: Record<string, string> = {} // path → exported interfaces/types
    const fileOpsApplied: Array<{ action: string; path: string }> = []

    // If plan includes shared types, generate them first
    if (plan.sharedTypes) {
      const typesPath = 'src/types/index.ts'
      generatedFiles[typesPath] = plan.sharedTypes
      contracts[typesPath] = plan.sharedTypes
      const ext = 'ts'
      await saveFile(projectId, userId, typesPath, plan.sharedTypes, ext, supabase)
      sendSSE({ type: 'file_op', action: 'create', path: typesPath, content: plan.sharedTypes })
      fileOpsApplied.push({ action: 'create', path: typesPath })
    }

    for (const [layerNum, layerFiles] of sortedLayers) {
      if (clientDisconnected) break

      // Check time remaining
      const elapsed = Date.now() - handlerStart
      if (elapsed > SAFE_DURATION_MS) {
        sendSSE({ type: 'status', text: 'Time limit approaching, saving progress...' })
        break
      }

      // Skip App.tsx in layers — it's generated last separately
      const filesToGenerate = layerFiles.filter(f => f.path !== 'src/App.tsx')
      if (filesToGenerate.length === 0) continue

      sendSSE({ type: 'status', text: `Generating layer ${layerNum} (${filesToGenerate.length} file${filesToGenerate.length > 1 ? 's' : ''})...` })

      // Generate all files in this layer in parallel
      const results = await Promise.allSettled(filesToGenerate.map(async (file) => {
        if (clientDisconnected) throw new Error('Client disconnected')
        if (!isValidFilePath(file.path)) {
          await log('parallel_security', 'warn', `Invalid path: ${file.path}`, userEmail)
          return null
        }

        const prompt = buildSingleFilePrompt({
          filePath: file.path,
          fileDescription: file.description,
          fileExports: file.exports,
          props: file.props,
          contracts,
          existingFiles: reactFiles,
          projectName,
          projectId: projectId || '',
          hasClientsDb: !!clientsDb,
          planManifest: plan,
        })

        const fileResponse = await client.messages.create({
          model: settings.chatModel,
          max_tokens: 8000,
          system: prompt + trainingRules,
          messages: [{ role: 'user', content: `Generate the file ${file.path}: ${file.description}` }],
        })

        totalInputTokens += fileResponse.usage.input_tokens
        totalOutputTokens += fileResponse.usage.output_tokens

        let content = fileResponse.content[0]?.type === 'text' ? fileResponse.content[0].text : ''
        // Strip markdown code fences if the model wraps the output
        content = content.replace(/^```(?:tsx?|jsx?|typescript|javascript)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

        return { path: file.path, content }
      }))

      // Process results
      let layerSuccesses = 0
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const { path, content } = result.value
          generatedFiles[path] = content
          // Small files (types, hooks, utils): pass full content as contract for maximum accuracy
          // Large files: extract just export signatures to avoid prompt bloat
          contracts[path] = content.length > 3000 ? extractContracts(content) : content

          const ext = path.split('.').pop()?.toLowerCase() || 'text'
          const fileType = ['tsx', 'ts'].includes(ext) ? 'ts' : ['jsx', 'js'].includes(ext) ? 'js' : ext
          await saveFile(projectId, userId, path, content, fileType, supabase)
          sendSSE({ type: 'file_op', action: 'create', path, content })
          fileOpsApplied.push({ action: 'create', path })
          layerSuccesses++
        } else if (result.status === 'rejected') {
          await log('parallel_file_error', 'warn', `File generation failed: ${result.reason?.message}`, userEmail)
        }
      }

      // If most files in a layer failed, abort
      if (layerSuccesses === 0 && filesToGenerate.length > 0) {
        await log('parallel_layer_failed', 'error', `Layer ${layerNum} completely failed`, userEmail)
        sendSSE({ type: 'status', text: `Layer ${layerNum} failed — falling back to single mode` })
        sendSSE({ type: 'redirect', target: 'single' })
        clearInterval(heartbeat)
        res.end()
        return
      }
    }

    // ── STEP 4: Generate App.tsx last ──────────────────────────
    if (!clientDisconnected) {
      sendSSE({ type: 'status', text: 'Generating App.tsx (root component)...' })

      const hasPages = Object.keys(generatedFiles).some(p => p.startsWith('src/pages/'))
      const appPrompt = buildAppTsxPrompt({
        allGeneratedFiles: generatedFiles,
        existingFiles: reactFiles,
        projectName,
        hasRouter: hasPages,
        planManifest: plan,
      })

      const appResponse = await client.messages.create({
        model: settings.chatModel,
        max_tokens: 8000,
        system: appPrompt + trainingRules,
        messages: [{ role: 'user', content: 'Generate App.tsx that imports and renders all the components and pages.' }],
      })

      totalInputTokens += appResponse.usage.input_tokens
      totalOutputTokens += appResponse.usage.output_tokens

      let appContent = appResponse.content[0]?.type === 'text' ? appResponse.content[0].text : ''
      appContent = appContent.replace(/^```(?:tsx?|jsx?|typescript|javascript)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

      if (appContent.length > 50) {
        await saveFile(projectId, userId, 'src/App.tsx', appContent, 'ts', supabase)
        sendSSE({ type: 'file_op', action: 'edit', path: 'src/App.tsx', content: appContent })
        fileOpsApplied.push({ action: 'edit', path: 'src/App.tsx' })
      }
    }

    // ── STEP 5: Cost calculation + credit deduction ────────────
    const totalTokens = totalInputTokens + totalOutputTokens
    const apiCost = (totalInputTokens / 1000) * settings.inputCostPer1k + (totalOutputTokens / 1000) * settings.outputCostPer1k
    const userCharge = apiCost * settings.markupMultiplier

    // Deduct credits
    try {
      await supabase.rpc('deduct_credits', {
        p_user_id: userId,
        p_amount: userCharge,
        p_description: `Parallel build: ${projectName} (${fileOpsApplied.length} files)`,
        p_tokens_used: totalTokens,
        p_api_cost: apiCost,
      })
    } catch (err: any) {
      await log('parallel_credits_error', 'error', `Credit deduction failed: ${err.message}`, userEmail)
    }

    // Track usage
    try {
      await supabase.from('usage').upsert({
        user_id: userId, month: new Date().toISOString().slice(0, 7), builds: 1, tokens: totalTokens,
      }, { onConflict: 'user_id,month' })
    } catch {}

    try {
      const today = new Date().toISOString().split('T')[0]
      await supabase.from('usage_daily').upsert({
        date: today, user_id: userId, project_id: projectId || null,
        builds: 1, tokens_input: totalInputTokens, tokens_output: totalOutputTokens,
        api_cost_anthropic: apiCost,
      }, { onConflict: 'date,user_id,project_id' })
    } catch {}

    const { data: updatedProfile } = await supabase
      .from('profiles').select('credit_balance, gift_balance').eq('id', userId).single()

    sendSSE({
      type: 'done',
      message: plan.message || `Built ${fileOpsApplied.length} files in parallel`,
      imagePrompts: [],
      tokensUsed: totalTokens,
      apiCost,
      userCharge,
      newBalance: (updatedProfile?.credit_balance || 0) + (updatedProfile?.gift_balance || 0),
      fileOps: fileOpsApplied,
      projectType: 'react',
      parallelMode: true,
      layers: sortedLayers.length,
    })

    await log('parallel_build_complete', 'info', `Parallel build: ${fileOpsApplied.length} files, ${sortedLayers.length} layers, ${totalTokens} tokens`, userEmail, {
      userId, projectId, files: fileOpsApplied.length, layers: sortedLayers.length, tokens: totalTokens, cost: apiCost,
    })

    clearInterval(heartbeat)
    res.end()

  } catch (err: any) {
    clearInterval(heartbeat)

    const errMsg = err.message || 'Unknown error'
    await log('parallel_error', 'error', `Parallel build failed: ${errMsg}`, userEmail, {
      userId, projectId, error: errMsg, stack: err.stack?.slice(0, 1000),
    })

    // Record failed cost
    if (totalInputTokens > 0 || totalOutputTokens > 0) {
      const failedCost = (totalInputTokens / 1000) * settings.inputCostPer1k + (totalOutputTokens / 1000) * settings.outputCostPer1k
      try {
        await supabase.from('transactions').insert({
          user_id: userId, amount: 0, api_cost: failedCost, tokens_used: totalInputTokens + totalOutputTokens,
          type: 'failed', description: `Parallel build failed: ${projectName} - ${errMsg.slice(0, 80)}`,
        })
      } catch {}
    }

    if (res.headersSent) {
      sendSSE({ type: 'error', error: errMsg })
      try { res.end() } catch {}
    } else {
      res.status(500).json({ error: errMsg })
    }
  }
}
