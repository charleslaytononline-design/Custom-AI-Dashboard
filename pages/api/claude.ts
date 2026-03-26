import type { NextApiRequest, NextApiResponse } from 'next'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { buildPageContext, compactHistory } from '../../lib/contextManager'
import { buildReactSystemPrompt, buildReactPlanPrompt } from '../../lib/reactPromptBuilder'
import { compactReactHistory } from '../../lib/reactContextManager'
import { loadProjectFiles, saveFile, deleteFile } from '../../lib/virtualFS'
import { getAuthUser } from '../../lib/apiAuth'
import { isValidUUID, isValidFilePath, isValidTableName, isValidColumnName, validateTableDef, validateAlterOps, sanitizeError, sanitizeTrainingRule } from '../../lib/validation'
import { checkRateLimit } from '../../lib/rateLimit'

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
  // SSE streaming requires no response size limit
  responseLimit: false,
}

// Central log helper — writes to platform_logs and fires email alert if configured
async function log(
  event_type: string,
  severity: 'info' | 'warn' | 'error',
  message: string,
  email?: string | null,
  metadata?: Record<string, unknown>
) {
  try {
    await supabase.from('platform_logs').insert({
      event_type, severity, message, email: email || null, metadata: metadata || null,
    })

    const { data: setting } = await supabase
      .from('log_alert_settings').select('send_email').eq('event_type', event_type).single()

    if (setting?.send_email && process.env.RESEND_API_KEY) {
      const alertEmail = process.env.ALERT_TO_EMAIL || 'charleslayton.online@gmail.com'
      const metaHtml = metadata
        ? `<pre style="background:#f4f4f4;padding:12px;border-radius:6px;font-size:12px;overflow:auto;white-space:pre-wrap">${JSON.stringify(metadata, null, 2)}</pre>`
        : ''
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.ALERT_FROM_EMAIL || 'alerts@resend.dev',
          to: alertEmail,
          subject: `[Dashboard Alert] ${event_type}`,
          html: `<div style="font-family:sans-serif;max-width:600px"><h2 style="color:#7c6ef7">Platform Alert</h2>
            <p style="color:#888;font-size:13px">${new Date().toUTCString()}</p>
            <table style="width:100%;font-size:14px">
              <tr><td style="color:#666;width:120px;padding:6px 0">Event</td><td style="font-weight:600">${event_type}</td></tr>
              <tr><td style="color:#666;padding:6px 0">Severity</td><td>${severity}</td></tr>
              ${email ? `<tr><td style="color:#666;padding:6px 0">User</td><td>${email}</td></tr>` : ''}
              <tr><td style="color:#666;padding:6px 0;vertical-align:top">Message</td><td>${message}</td></tr>
            </table>${metaHtml}</div>`,
        }),
      }).catch(() => {})
    }
  } catch {/* don't let logging failures break the main flow */}
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
    imageCostPerGen: parseFloat(map['image_cost_per_gen']) || 0.05,
    maxImagesPerBuild: parseInt(map['max_images_per_build']) || 5,
  }
}

async function getTrainingRules(userMessage: string) {
  const { data: rules } = await supabase
    .from('ai_training_rules')
    .select('*')
    .eq('enabled', true)
    .order('priority', { ascending: false })

  if (!rules || rules.length === 0) return ''

  const matched: string[] = []
  const msg = userMessage.toLowerCase()

  for (const rule of rules) {
    if (rule.type === 'global') {
      matched.push(sanitizeTrainingRule(rule.instructions))
    } else if (rule.type === 'keyword' && rule.keywords) {
      const keywords = rule.keywords.split(',').map((k: string) => k.trim().toLowerCase())
      if (keywords.some((kw: string) => kw && msg.includes(kw))) {
        matched.push(sanitizeTrainingRule(rule.instructions))
      }
    }
  }

  if (matched.length === 0) return ''
  return '\n\nAI TRAINING RULES (follow these additional design and behavior instructions carefully):\n' + matched.map((m, i) => `${i + 1}. ${m}`).join('\n')
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const SAFE_DURATION_MS = 270_000 // 270s safety cutoff, leaving 30s buffer before Vercel's 300s kill
  const handlerStart = Date.now()

  // Verify server-side session
  const sessionUserId = await getAuthUser(req, res)
  if (!sessionUserId) return res.status(401).json({ error: 'Not authenticated' })

  const { messages, pageCode, pageName, allPages, planOnly, imageBase64, imageMediaType, projectId, retryCount = 0, isAutoFix = false, isContinuation = false, partialRaw = '', continuationCount = 0, accumulatedApiCost = 0 } = req.body
  const userId = sessionUserId

  // SECURITY: validate projectId format
  if (projectId && !isValidUUID(projectId)) {
    return res.status(400).json({ error: 'Invalid project ID' })
  }

  // SECURITY: rate limit — max 10 builds per minute per user
  if (!checkRateLimit(`build:${userId}`, 10, 60_000)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait before building again.' })
  }

  // Reject if too many continuations
  if (isContinuation && continuationCount > 5) {
    return res.status(400).json({ error: 'Build is too complex to complete within server time limits. Please simplify your request or build one section at a time.' })
  }

  // Look up user profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('credit_balance, gift_balance, role, email, plan_id').eq('id', userId).single()

  if (!profile) {
    await log('api_error', 'error', `Profile not found for userId: ${userId}`, null, { userId, profileError })
    return res.status(401).json({ error: 'User not found' })
  }

  const userEmail = profile.email || null

  // Role permission check: can this user build?
  const { data: rolePerms } = await supabase.from('roles').select('can_build').eq('name', profile.role).single()
  if (rolePerms && !rolePerms.can_build) {
    await log('role_blocked', 'warn', `Build blocked — role "${profile.role}" cannot build`, userEmail, { userId })
    return res.status(403).json({ error: 'Your account role does not allow building. Contact an administrator.' })
  }

  // Credit check (purchased + gift combined)
  const totalBalance = (profile.credit_balance || 0) + (profile.gift_balance || 0)
  if (totalBalance <= 0) {
    await log('credits_error', 'warn', `Build blocked — insufficient credits`, userEmail, {
      userId, balance: profile.credit_balance, giftBalance: profile.gift_balance, pageName,
    })
    return res.status(402).json({
      error: 'insufficient_credits',
      message: 'You need to purchase credits to continue building.',
      balance: profile.credit_balance,
    })
  }

  // Plan build-limit check (resolves Free plan for null plan_id) — skip on continuations (same build)
  if (userId && !planOnly && !isContinuation) {
    const planId = profile.plan_id || null
    const { data: plan } = planId
      ? await supabase.from('plans').select('name, max_builds_per_month').eq('id', planId).single()
      : await supabase.from('plans').select('name, max_builds_per_month').eq('price_monthly', 0).order('sort_order', { ascending: true }).limit(1).single()
    if (plan?.max_builds_per_month && plan.max_builds_per_month !== -1) {
      const monthStart = new Date()
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
      const { count } = await supabase.from('usage').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', monthStart.toISOString())
      if (count !== null && count >= plan.max_builds_per_month) {
        return res.status(200).json({
          error: 'build_limit_reached',
          message: `You've used all ${plan.max_builds_per_month} builds this month on the ${plan.name} plan. Upgrade to build more.`,
          planName: plan.name,
        })
      }
    }
  }

  const settings = await getSettings()
  const lastUserMsg = messages[messages.length - 1]?.content || ''
  const userPrompt = typeof lastUserMsg === 'string' ? lastUserMsg : ''

  // Detect project type
  let projectType = 'html'
  let projectName = ''
  let layoutCode: string | null = null
  let dbProvider: string | null = null
  if (projectId) {
    const { data: proj } = await supabase.from('projects').select('layout_code, project_type, name, db_provider').eq('id', projectId).eq('user_id', userId).single()
    projectType = proj?.project_type || 'html'
    projectName = proj?.name || ''
    layoutCode = proj?.layout_code || null
    dbProvider = proj?.db_provider || null
  }

  // For React projects, load project files and build context differently
  let reactFiles: any[] = []
  if (projectType === 'react' && projectId) {
    reactFiles = await loadProjectFiles(projectId)
  }

  // HTML-specific context (only for html projects)
  const pageContext = projectType === 'html' ? buildPageContext(
    { name: pageName || 'Page', code: pageCode || '' },
    (allPages || []).map((p: any) => ({ name: p.name, code: p.code || '' })),
    userPrompt,
  ) : ''
  const pageList = allPages ? allPages.map((p: any) => p.name).join(', ') : 'none'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://login.customaidashboard.com'

  const hasLayout = projectType === 'html' && !!layoutCode

  // Build system prompt based on project type
  let system: string
  if (projectType === 'react') {
    // React project prompt
    const activeFile = req.body.activeFilePath || null
    if (planOnly) {
      system = buildReactPlanPrompt({
        projectName,
        allFiles: reactFiles,
        hasClientsDb: !!clientsDb,
      })
    } else {
      system = buildReactSystemPrompt({
        projectName,
        projectId: projectId || '',
        allFiles: reactFiles,
        activeFilePath: activeFile,
        userPrompt,
        maxImagesPerBuild: settings.maxImagesPerBuild,
        hasClientsDb: !!clientsDb,
      })
    }
  } else if (planOnly) {
    system = `You are an AI app builder. The user wants to build something on a page called "${pageName}".
Write a clear bullet-point plan of what you will build. No code. Max 8 bullet points.
IMPORTANT: Keep plans realistic — the builder can output ~8,000 tokens of HTML per build. Plan 4-6 focused sections maximum, not 10+. Prioritize core content and functionality over decorative extras. A concise, well-built page is better than an ambitious one that times out.
If the request involves multiple pages, list which pages you'll create and what each contains.
Respond in plain text only.`
  } else {
    system = `You are an expert UI engineer inside "Custom AI Dashboard" — a professional AI app builder like Lovable.

${pageContext}
${hasLayout ? `PROJECT HAS SHARED LAYOUT: Yes (sidebar + topbar are provided automatically)` : `PROJECT HAS SHARED LAYOUT: No (this is a new project or legacy project)`}

CURRENT PAGE CODE:
\`\`\`html
${pageCode || '<!-- empty page -->'}
\`\`\`
${hasLayout ? `
CURRENT LAYOUT:
\`\`\`html
${layoutCode}
\`\`\`` : ''}

MULTI-PAGE APP SYSTEM:
This builder supports real multi-page apps. Each page in the project is a separate file with its own code.
A shared LAYOUT (sidebar + topbar) is stored at the project level and automatically wraps every page.

PAGE CREATION — to create new pages, output <CREATE_PAGE> tags BEFORE the CODE block:
<CREATE_PAGE>Dashboard</CREATE_PAGE>
<CREATE_PAGE>Leads</CREATE_PAGE>
<CREATE_PAGE>Settings</CREATE_PAGE>
Create pages when the user asks for a multi-page app or when features need their own page.
The current build will apply to the CURRENT PAGE ("${pageName}"). Other new pages start empty.

LAYOUT — to create or update the shared sidebar/topbar, output a <LAYOUT> tag BEFORE the CODE block:
<LAYOUT>
<aside class="fixed left-0 top-0 h-screen w-56 bg-[#0f0f0f] border-r border-white/[0.06] flex flex-col z-40">
  <div class="p-4 border-b border-white/[0.06] flex items-center gap-2.5">
    <div class="w-8 h-8 rounded-lg bg-brand flex items-center justify-center text-white text-xs font-bold">AI</div>
    <span class="text-white font-semibold text-sm">App Name</span>
  </div>
  <nav class="flex-1 p-2 space-y-0.5">
    <a data-page="Dashboard" class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm cursor-pointer text-gray-400 hover:text-white hover:bg-white/5 transition-all">
      <i class="fa-solid fa-gauge w-4 text-center text-xs"></i><span>Dashboard</span>
    </a>
    <a data-page="Leads" class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm cursor-pointer text-gray-400 hover:text-white hover:bg-white/5 transition-all">
      <i class="fa-solid fa-users w-4 text-center text-xs"></i><span>Leads</span>
    </a>
  </nav>
</aside>
<header class="fixed top-0 left-56 right-0 h-14 bg-[#0a0a0a] border-b border-white/[0.06] flex items-center justify-between px-6 z-30">
  <h1 class="text-white font-medium text-sm">${pageName}</h1>
</header>
</LAYOUT>

LAYOUT RULES:
- Use data-page="PageName" on nav links — the platform handles page switching automatically
- Do NOT use href for page links. data-page triggers real page navigation.
- Include an icon (Font Awesome) + label for each nav item
- The layout is injected automatically — do NOT include sidebar/topbar in your CODE block
- ${hasLayout ? 'A layout already exists. Only output <LAYOUT> if the user asks to change navigation or add pages.' : 'This project has no layout yet. Generate a <LAYOUT> tag on this first build.'}

IMAGE GENERATION CAPABILITY:
Generate up to ${settings.maxImagesPerBuild} real AI images per build using Flux. Output BEFORE the CODE block:
<GENERATE_IMAGE>prompt for image 1</GENERATE_IMAGE>
<GENERATE_IMAGE>prompt for image 2</GENERATE_IMAGE>
In CODE, reference images by number:
<img src="__GENERATED_IMAGE_1__" alt="description" class="..." />
<img src="__GENERATED_IMAGE_2__" alt="description" class="..." />
You can also use __GENERATED_IMAGE_URL__ as shorthand for the first image.
IMPORTANT: Only use __GENERATED_IMAGE_N__ placeholders when you also output a matching <GENERATE_IMAGE> tag. For showcase galleries, app screenshots, or decorative images where AI generation isn't needed, use CSS gradients, SVG illustrations, or Font Awesome icons instead.

CRITICAL IMAGE PROMPT RULES:
- The image prompt MUST describe exactly what the user asked for. If they say "a fluffy dog", the prompt MUST be about a fluffy dog — never something else.
- Be extremely specific and literal: subject, setting, lighting, style, colors, mood, camera angle.
- Always include quality modifiers: "high quality, professional, detailed, 8k, sharp focus"
- For photos: add "professional photography, studio lighting, shallow depth of field"
- For illustrations: add "digital illustration, vibrant colors, clean lines"
- NEVER creatively reinterpret the user's request into a different subject. Match their description exactly.
- Maximum ${settings.maxImagesPerBuild} images per build — if more are needed, use CSS/icon placeholders for the rest.

DATABASE CAPABILITY:
Create real persistent tables. Output one <CREATE_TABLE> per table, BEFORE the CODE block:
<CREATE_TABLE>
{"name":"table_name","columns":[
  {"name":"id","type":"uuid","primaryKey":true},
  {"name":"field_name","type":"text"},
  {"name":"tags","type":"text[]"},
  {"name":"created_at","type":"timestamptz","default":"now()"}
]}
</CREATE_TABLE>

Allowed types: uuid, text, integer, numeric, boolean, timestamptz, jsonb, bigint, text[], integer[], uuid[]
Rules: Always include id (uuid, primaryKey) + created_at (timestamptz, default now()). Use text[] for arrays, jsonb for nested data.

PLATFORM HELPERS (auto-included on every page):
The following functions are automatically available on every page. Do NOT re-declare them in your CODE:
- dbQuery(table, action, data) — database CRUD (select, insert, update, delete). Returns {data, error}.
- serverRun(functionName, params) — call server-side functions (future feature)
- sendEmail(to, subject, html) — send emails (future feature)
- PROJECT_ID — the current project ID constant (auto-set)

DATABASE USAGE:
In your CODE, just call dbQuery directly — it is already available, do NOT redeclare it:
  const {data} = await dbQuery('leads', 'select')
  await dbQuery('leads', 'insert', {name: 'John', email: 'john@test.com'})
  await dbQuery('leads', 'update', {id: '...', name: 'Jane'})
  await dbQuery('leads', 'delete', {id: '...'})
Use real DB for: forms, CRM records, orders. Use localStorage for: UI state, config, display preferences.

SHARED CODE:
To define utility functions shared across ALL pages in this project, output a <SHARED_CODE> tag BEFORE CODE:
<SHARED_CODE>
function formatCurrency(a){return '$'+Number(a).toFixed(2)}
function formatDate(d){return new Date(d).toLocaleDateString()}
</SHARED_CODE>
These functions are auto-included on every page via a shared script. Only output <SHARED_CODE> when:
- This is the first build and you need shared utilities
- The user explicitly asks to add/change shared functions
Do NOT re-output <SHARED_CODE> on every build — it persists across builds.

RESPONSE FORMAT:
Output special tags first (<CREATE_PAGE>, <LAYOUT>, <CREATE_TABLE>, <GENERATE_IMAGE>, <SHARED_CODE>) then:
<MESSAGE>Brief description of what you built</MESSAGE>
<CODE>
${hasLayout ? '<!-- Page content only — layout is automatic -->' : '<!DOCTYPE html>\\n... complete HTML page ...\\n</html>'}
</CODE>

${hasLayout ? `IMPORTANT — CONTENT-ONLY MODE:
Since this project has a shared layout, your CODE block should contain ONLY the page content.
Do NOT include <!DOCTYPE html>, <html>, <head>, <body>, sidebar, or topbar.
The layout wraps your content automatically inside <main class="ml-56 mt-14 min-h-screen">.
Your CODE starts directly with the page content (divs, sections, etc).
Include <script> tags for Alpine.js data and dbQuery if needed.` : `FULL PAGE MODE:
This project has no layout yet. Output a complete <!DOCTYPE html> document.
Include all CDN scripts in <head>. Include sidebar and topbar in <body>.
STACK — always include:
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{brand:{DEFAULT:'#7c6ef7',dark:'#5b50d6'}}}}}</script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">`}

DESIGN SYSTEM:
- Page bg: #0a0a0a | Cards: bg-[#141414] border border-white/[0.06] rounded-xl p-5
- Buttons: bg-brand hover:bg-brand-dark text-white rounded-lg px-4 py-2 text-sm font-medium
- Inputs: bg-[#1e1e1e] border border-white/[0.08] rounded-lg px-3 py-2 text-white text-sm
- Tables: bg-[#141414] border border-white/[0.06] rounded-xl overflow-hidden
- Badges: bg-emerald-500/10 text-emerald-400 (green) | bg-red-500/10 text-red-400 (red) | bg-amber-500/10 text-amber-400 (yellow)
- Empty states: centered icon + message + action button
- Loading: skeleton with animate-pulse bg-white/5
- Use Alpine.js x-data for page state, Alpine.store for shared app state

RULES:
- Output ONLY the XML format — nothing before tags or after CODE closing tag
- Use Tailwind classes only — no inline styles
- Every button must be functional
- Keep ALL existing features when updating
- CRITICAL: Keep HTML output under 8,000 tokens. You have ~45 seconds of generation time — be concise.
- Write concise clean code. No comments, no lorem ipsum, no verbose spacing.
- Build core functionality first — skip decorative extras on large requests.
- Prioritize finishing over perfection. A complete 5-section page beats an incomplete 10-section page.
- For landing/marketing pages without a shared layout, always include a sticky top navigation bar with site name and anchor links to the main sections (e.g., #features, #pricing, #faq). Use smooth scrolling with scroll-behavior:smooth on html.`
  } // end project type branching

  // Inject AI training rules from database
  const userMsg = messages[messages.length - 1]?.content || ''
  const trainingRules = await getTrainingRules(typeof userMsg === 'string' ? userMsg : '')
  const autoFixAddendum = isAutoFix
    ? `\n\nERROR FIX MODE: The user is reporting runtime JavaScript errors in the current page code. Fix ONLY the bug — do not redesign, restructure, or add new features. Return the complete fixed page code in <CODE> tags and a brief description of the fix in <MESSAGE> tags. Keep changes minimal — change as few lines as possible.`
    : ''
  const systemWithTraining = system + trainingRules + autoFixAddendum

  // Helper to send an SSE event
  function sendSSE(data: object) {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  let heartbeat: ReturnType<typeof setInterval> | null = null
  let finalMessage: any = null // declared outside try so catch can access for failed cost tracking
  let clientDisconnected = false
  let streamCompleted = false
  let raw = ''
  let imagePrompts: string[] = []

  try {
    const lastMessage = messages[messages.length - 1]

    let lastContent: any = lastMessage?.content || ''
    if (imageBase64 && imageMediaType) {
      lastContent = [
        { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageBase64 } },
        { type: 'text', text: typeof lastMessage?.content === 'string' ? lastMessage.content : 'See the image above.' },
      ]
    }

    // For continuations, override the last message to ask Claude to finish where it left off
    if (isContinuation && partialRaw) {
      if (projectType === 'react') {
        lastContent = `Your previous response was cut off due to a time limit. Here is what you generated so far:\n\n\`\`\`\n${partialRaw}\n\`\`\`\n\nContinue EXACTLY where you left off. Do NOT restart from the beginning. Do NOT repeat any FILE_OP tags already generated. Complete the current FILE_OP if it was cut off, then output remaining FILE_OPs. Close all open tags. You must finish within this response.`
      } else {
        lastContent = `Your previous response was cut off due to a time limit. Here is what you generated so far:\n\n\`\`\`\n${partialRaw}\n\`\`\`\n\nContinue EXACTLY where you left off. Do NOT restart from the beginning. Do NOT repeat any code. WRAP UP CONCISELY — close remaining sections with minimal content, close all open HTML tags, and include </CODE> at the end. You must finish within this response. Do not add new sections — just complete what you started.`
      }
    }

    const rawHistory = messages.slice(0, -1).map((m: any) => ({ role: m.role, content: m.content }))
    const { summary, recentMessages } = projectType === 'react'
      ? compactReactHistory(rawHistory, 4)
      : compactHistory(rawHistory, 4)
    const firstUserIdx = recentMessages.findIndex((m: any) => m.role === 'user')
    const safeHistory = firstUserIdx > 0 ? recentMessages.slice(firstUserIdx) : recentMessages

    // If we have a summary of older messages, prepend it as a system-level context
    const contextualSystem = summary
      ? systemWithTraining + `\n\nCONVERSATION CONTEXT:\n${summary}`
      : systemWithTraining

    const apiMessages = [
      ...safeHistory,
      { role: lastMessage?.role || 'user', content: lastContent },
    ]

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.status(200)

    // Track client disconnect (user clicked Stop or closed tab)
    res.on('close', () => { clientDisconnected = true })

    // Send immediate status to prevent early idle timeout
    sendSSE({ type: 'status', text: isContinuation ? `Continuing build (part ${continuationCount + 1})...` : 'Starting build...' })

    // Use streaming API
    const stream = client.messages.stream({
      model: settings.chatModel,
      max_tokens: 16000,
      system: contextualSystem,
      messages: apiMessages,
    })

    const streamStart = Date.now()

    // Stream text deltas to the client
    stream.on('text', (text) => {
      raw += text
      if (clientDisconnected) {
        try { stream.abort() } catch (_) {}
        return
      }
      sendSSE({ type: 'delta', text })
    })

    // Race: stream completion vs safety timeout before Vercel kills the function
    const timeRemaining = Math.max(SAFE_DURATION_MS - (Date.now() - handlerStart), 10_000)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('__CONTINUATION__')), timeRemaining)
    })

    try {
      finalMessage = await Promise.race([stream.finalMessage(), timeoutPromise])
    } catch (timeoutErr: any) {
      // Handle client disconnect (user clicked Stop)
      if (clientDisconnected) {
        try { stream.abort() } catch (_) {}
        const estimatedOutputTokens = Math.ceil(raw.length / 4)
        const partialCost = (estimatedOutputTokens / 1000) * settings.outputCostPer1k

        // Check if user has exceeded stop limit — if so, charge them normally
        let chargeUser = false
        try {
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
          const { count } = await supabase.from('transactions').select('*', { count: 'exact', head: true })
            .eq('user_id', userId).eq('type', 'stopped').gte('created_at', oneHourAgo)
          const { data: limitSetting } = await supabase.from('settings').select('value').eq('key', 'stop_limit_per_hour').single()
          const stopLimit = parseInt(limitSetting?.value || '5', 10)
          if (count !== null && count >= stopLimit) chargeUser = true
        } catch (_) {}

        const userCharge = chargeUser ? partialCost * settings.markupMultiplier : 0
        const txType = chargeUser ? 'usage' : 'stopped'

        try {
          await supabase.from('transactions').insert({
            user_id: userId, amount: userCharge, api_cost: partialCost, tokens_used: estimatedOutputTokens,
            type: txType, description: `User stopped ${planOnly ? 'plan' : 'build'}: ${pageName}${chargeUser ? ' (stop limit exceeded, charged)' : ''}`,
          })
          if (chargeUser) {
            await supabase.rpc('deduct_credits', { p_user_id: userId, p_amount: userCharge, p_description: `Stopped build (limit exceeded): ${pageName}`, p_tokens_used: estimatedOutputTokens, p_api_cost: partialCost })
          }
        } catch (_) {}

        await log('builder_stopped', 'info', `Build stopped by user after ${((Date.now() - handlerStart) / 1000).toFixed(1)}s`, userEmail, {
          userId, pageName, partialChars: raw.length, estimatedCost: partialCost, chargedUser: chargeUser,
        })
        try { res.end() } catch (_) {}
        return
      }

      if (timeoutErr.message === '__CONTINUATION__') {
        // Gracefully abort the stream and send continuation signal to client
        try { stream.abort() } catch (_) {}
        const elapsed = ((Date.now() - handlerStart) / 1000).toFixed(1)
        // Estimate cost of partial response (we don't have finalMessage.usage since stream was aborted)
        const estimatedOutputTokens = Math.ceil(raw.length / 4)
        const partialCost = (estimatedOutputTokens / 1000) * settings.outputCostPer1k
        const newAccumulatedCost = accumulatedApiCost + partialCost

        await log('builder_continuation', 'info', `Build timed out after ${elapsed}s, sending continuation signal (part ${continuationCount + 1})`, userEmail, {
          userId, pageName, elapsed, partialChars: raw.length, continuationCount, estimatedPartialCost: partialCost,
        })
        // Record continuation event in transactions for tracking
        try {
          await supabase.from('transactions').insert({
            user_id: userId, amount: 0, api_cost: partialCost, tokens_used: estimatedOutputTokens,
            type: 'continuation', description: `Build continuation part ${continuationCount + 1}: ${pageName}`,
          })
        } catch (_) {} // don't let tracking failure block the continuation

        sendSSE({ type: 'continue', partialRaw: (partialRaw || '') + raw, continuationCount: continuationCount + 1, accumulatedApiCost: newAccumulatedCost })
        res.end()
        return
      }
      throw timeoutErr
    }

    // Stream completed — mark so disconnect handler won't double-record
    streamCompleted = true

    // Start heartbeat to keep connection alive during post-processing (image gen, table creation, etc.)
    heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n') } catch (_) { /* connection already closed */ }
    }, 5000)

    const inputTokens = finalMessage.usage.input_tokens
    const outputTokens = finalMessage.usage.output_tokens
    const totalTokens = inputTokens + outputTokens
    const apiCost = (inputTokens / 1000) * settings.inputCostPer1k + (outputTokens / 1000) * settings.outputCostPer1k
    const totalApiCost = apiCost + accumulatedApiCost // include costs from prior continuations
    const userCharge = totalApiCost * settings.markupMultiplier
    const stopReason = finalMessage.stop_reason

    // Extract image prompts — frontend will generate images after build completes (avoids timeout)
    const imageSearchText = (isContinuation && partialRaw) ? partialRaw + raw : raw
    const imageRegex = /<GENERATE_IMAGE>([\s\S]*?)<\/GENERATE_IMAGE>/gi
    imagePrompts = []
    let imgMatch: RegExpExecArray | null
    while ((imgMatch = imageRegex.exec(imageSearchText)) !== null) {
      imagePrompts.push(imgMatch[1].trim())
    }
    const trimmedImagePrompts = imagePrompts.slice(0, settings.maxImagesPerBuild)

    // --- Post-processing: run independent tasks in parallel ---
    sendSSE({ type: 'status', text: 'Processing build...' })

    // Parse all tags upfront (sync, fast)
    const tableDefsFound: RegExpExecArray[] = []
    const tableRegex = /<CREATE_TABLE(?:\s+realtime="true")?>([\s\S]*?)<\/CREATE_TABLE>/gi
    let tableMatch: RegExpExecArray | null
    while ((tableMatch = tableRegex.exec(raw)) !== null) tableDefsFound.push(tableMatch)

    // Parse ALTER_TABLE tags
    const alterTableDefs: RegExpExecArray[] = []
    const alterRegex = /<ALTER_TABLE>([\s\S]*?)<\/ALTER_TABLE>/gi
    let alterMatch: RegExpExecArray | null
    while ((alterMatch = alterRegex.exec(raw)) !== null) alterTableDefs.push(alterMatch)

    // Parse ENABLE_RLS tags
    const rlsOps: Array<{ table: string; column: string }> = []
    const rlsRegex = /<ENABLE_RLS\s+table="([^"]+)"\s+column="([^"]+)"\s*\/>/gi
    let rlsMatch: RegExpExecArray | null
    while ((rlsMatch = rlsRegex.exec(raw)) !== null) {
      if (isValidTableName(rlsMatch[1]) && isValidColumnName(rlsMatch[2])) {
        rlsOps.push({ table: rlsMatch[1], column: rlsMatch[2] })
      }
    }

    // Parse ENABLE_REALTIME tags
    const realtimeOps: string[] = []
    const rtRegex = /<ENABLE_REALTIME\s+table="([^"]+)"\s*\/>/gi
    let rtMatch: RegExpExecArray | null
    while ((rtMatch = rtRegex.exec(raw)) !== null) {
      if (isValidTableName(rtMatch[1])) realtimeOps.push(rtMatch[1])
    }

    // Parse SETUP_STORAGE tags
    const setupStorage = /<SETUP_STORAGE\s*\/>/.test(raw)

    const layoutMatch = raw.match(/<LAYOUT>([\s\S]*?)<\/LAYOUT>/i)

    const pageRegex = /<CREATE_PAGE>([\s\S]*?)<\/CREATE_PAGE>/gi
    const newPages: string[] = []
    let pageMatch: RegExpExecArray | null
    while ((pageMatch = pageRegex.exec(raw)) !== null) {
      const newPageName = pageMatch[1].trim()
      if (!newPageName) continue
      const existingNames = (allPages || []).map((p: any) => p.name.toLowerCase())
      if (existingNames.includes(newPageName.toLowerCase())) continue
      if (newPageName.toLowerCase() === (pageName || '').toLowerCase()) continue
      newPages.push(newPageName)
    }

    const sharedCodeMatch = raw.match(/<SHARED_CODE>([\s\S]*?)<\/SHARED_CODE>/i)

    // Run all independent post-processing tasks in parallel
    const postTasks: Promise<void>[] = []

    // Task: Create database tables (parallel within this task too)
    // If tables are needed but user hasn't chosen a database provider yet, ask them
    if (tableDefsFound.length > 0 && projectId && !planOnly && !dbProvider) {
      const pendingTables = tableDefsFound.map(m => {
        try { return JSON.parse(m[1].trim()).name } catch { return 'unknown' }
      })
      sendSSE({ type: 'db_choice_required', pendingTables })
      // Stop processing — the frontend will show the choice modal and retry
      sendSSE({ type: 'done', message: 'Please choose where to store your data, then I\'ll create the tables.' })
      res.end()
      return
    }

    if (tableDefsFound.length > 0 && clientsDb && projectId && !planOnly) {
      postTasks.push((async () => {
        const schemaName = `proj_${projectId}`
        const planId = profile.plan_id || null
        const { data: plan } = planId
          ? await supabase.from('plans').select('max_tables_per_project').eq('id', planId).single()
          : await supabase.from('plans').select('max_tables_per_project').eq('price_monthly', 0).order('sort_order', { ascending: true }).limit(1).single()
        const { data: usageRow } = await clientsDb.from('schema_usage').select('table_count').eq('project_id', projectId).single()
        const currentCount = usageRow?.table_count || 0
        const tableLimit = plan?.max_tables_per_project ?? 5

        // Enforce limit, then create all allowed tables in parallel
        const allowedDefs = tableDefsFound.slice(0, Math.max(0, tableLimit - currentCount))
        if (allowedDefs.length < tableDefsFound.length) {
          sendSSE({ type: 'status', text: `Table limit reached (${tableLimit} tables). Upgrade your plan for more.` })
        }

        const tableResults = await Promise.allSettled(allowedDefs.map(async (match) => {
          const tableDef = JSON.parse(match[1].trim())
          // SECURITY: validate table definition before sending to RPC
          const validation = validateTableDef(tableDef)
          if (!validation.valid) {
            throw new Error(`Invalid table definition: ${validation.error}`)
          }
          await clientsDb.rpc('create_project_table', { schema_name: schemaName, table_def: tableDef })
        }))

        const tablesCreated = tableResults.filter(r => r.status === 'fulfilled').length
        for (const r of tableResults) {
          if (r.status === 'rejected') {
            await log('builder_error', 'warn', `CREATE_TABLE failed: ${r.reason?.message}`, userEmail, { userId, projectId })
          }
        }

        if (tablesCreated > 0) {
          await Promise.all([
            clientsDb.from('schema_registry').upsert(
              { project_id: projectId, user_id: userId, schema_name: schemaName, last_accessed_at: new Date().toISOString() },
              { onConflict: 'project_id' }
            ),
            clientsDb.from('schema_usage').upsert(
              { project_id: projectId, user_id: userId, schema_name: schemaName, table_count: currentCount + tablesCreated, sampled_at: new Date().toISOString() },
              { onConflict: 'project_id' }
            ),
          ])
        }
      })())
    }

    // Task: ALTER TABLE operations
    if (alterTableDefs.length > 0 && clientsDb && projectId && !planOnly) {
      postTasks.push((async () => {
        const schemaName = `proj_${projectId}`
        for (const match of alterTableDefs) {
          try {
            const alterDef = JSON.parse(match[1].trim())
            if (!isValidTableName(alterDef.table)) {
              await log('builder_security', 'warn', `ALTER_TABLE blocked: invalid table name`, userEmail, { userId, projectId })
              continue
            }
            const validation = validateAlterOps(alterDef.operations)
            if (!validation.valid) {
              await log('builder_security', 'warn', `ALTER_TABLE blocked: ${validation.error}`, userEmail, { userId, projectId })
              continue
            }
            await clientsDb.rpc('alter_project_table', {
              p_schema: schemaName,
              p_table: alterDef.table,
              p_operations: alterDef.operations,
            })
            sendSSE({ type: 'status', text: `Altered table ${alterDef.table}` })
            await log('db_alter_table', 'info', `ALTER TABLE ${alterDef.table}`, userEmail, { userId, projectId, operations: alterDef.operations })
          } catch (err: any) {
            await log('builder_error', 'warn', `ALTER_TABLE failed: ${sanitizeError(err)}`, userEmail, { userId, projectId })
          }
        }
      })())
    }

    // Task: ENABLE_RLS on tables
    if (rlsOps.length > 0 && clientsDb && projectId && !planOnly) {
      postTasks.push((async () => {
        const schemaName = `proj_${projectId}`
        for (const op of rlsOps) {
          try {
            // Enable RLS and create 4 policies (SELECT, INSERT, UPDATE, DELETE)
            const commands = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
            for (const cmd of commands) {
              await clientsDb.rpc('create_project_rls_policy', {
                p_schema: schemaName,
                p_table: op.table,
                p_policy_name: `${op.table}_${cmd.toLowerCase()}_own`,
                p_command: cmd,
                p_using_expr: `${op.column} = auth.uid()`,
                p_check_expr: cmd === 'INSERT' || cmd === 'UPDATE' ? `${op.column} = auth.uid()` : null,
              })
            }
            sendSSE({ type: 'status', text: `Enabled RLS on ${op.table}` })
            await log('db_enable_rls', 'info', `RLS enabled on ${op.table}`, userEmail, { userId, projectId, table: op.table, column: op.column })
          } catch (err: any) {
            await log('builder_error', 'warn', `ENABLE_RLS failed: ${sanitizeError(err)}`, userEmail, { userId, projectId })
          }
        }
      })())
    }

    // Task: ENABLE_REALTIME on tables
    if (realtimeOps.length > 0 && clientsDb && projectId && !planOnly) {
      postTasks.push((async () => {
        const schemaName = `proj_${projectId}`
        for (const table of realtimeOps) {
          try {
            await clientsDb.rpc('enable_realtime_for_table', {
              p_schema: schemaName,
              p_table: table,
            })
            sendSSE({ type: 'status', text: `Enabled realtime on ${table}` })
            await log('db_enable_realtime', 'info', `Realtime enabled on ${table}`, userEmail, { userId, projectId, table })
          } catch (err: any) {
            await log('builder_error', 'warn', `ENABLE_REALTIME failed: ${sanitizeError(err)}`, userEmail, { userId, projectId })
          }
        }
      })())
    }

    // Task: SETUP_STORAGE for the project
    if (setupStorage && clientsDb && projectId && !planOnly) {
      postTasks.push((async () => {
        try {
          await clientsDb.rpc('create_project_storage_bucket', { p_project_id: projectId })
          sendSSE({ type: 'status', text: 'Storage bucket created' })
          await log('db_setup_storage', 'info', `Storage bucket created`, userEmail, { userId, projectId })
        } catch (err: any) {
          await log('builder_error', 'warn', `SETUP_STORAGE failed: ${sanitizeError(err)}`, userEmail, { userId, projectId })
        }
      })())
    }

    // Task: Save layout
    if (layoutMatch && projectId && !planOnly) {
      postTasks.push((async () => {
        const newLayout = layoutMatch[1].trim()
        await supabase.from('projects').update({ layout_code: newLayout }).eq('id', projectId)
      })())
    }

    // Task: Create new pages (all in parallel)
    if (newPages.length > 0 && projectId && !planOnly) {
      postTasks.push((async () => {
        await Promise.allSettled(newPages.map(name =>
          supabase.from('pages').insert({ project_id: projectId, user_id: userId, name, code: `<!-- Page: ${name} — build this page next -->` })
        ))
      })())
    }

    // Task: Save shared code
    if (sharedCodeMatch && projectId && !planOnly) {
      postTasks.push((async () => {
        const newSharedCode = sharedCodeMatch[1].trim()
        const { data: existing } = await supabase.from('project_shared_code').select('id').eq('project_id', projectId).single()
        if (existing) {
          await supabase.from('project_shared_code').update({ code: newSharedCode, updated_at: new Date().toISOString() }).eq('project_id', projectId)
        } else {
          await supabase.from('project_shared_code').insert({ project_id: projectId, user_id: userId, code: newSharedCode })
        }
      })())
    }

    // Wait for all post-processing to complete
    await Promise.allSettled(postTasks)

    const imagePlaceholder = 'https://placehold.co/1024x768/141414/444444?text=Loading+image...'

    // Replace image placeholders with loading placeholders (frontend will replace with real URLs after build)
    const replaceImagePlaceholders = (html: string): string => {
      html = html.replace(/__GENERATED_IMAGE_URL__/g, imagePlaceholder)
      // Keep numbered placeholders distinct so frontend can replace each individually
      html = html.replace(/__GENERATED_IMAGE_(\d+)__/g, (_, n) =>
        `https://placehold.co/1024x768/141414/444444?text=Loading+image+${n}...`
      )
      return html
    }

    // Deduct credits from everyone including admin (includes accumulated costs from continuations)
    const buildDesc = continuationCount > 0 ? `AI build: ${pageName} (continued ${continuationCount}x)` : `AI build: ${pageName}`
    const { data: deducted } = await supabase.rpc('deduct_credits', {
      p_user_id: userId,
      p_amount: userCharge,
      p_description: buildDesc,
      p_tokens_used: totalTokens,
      p_api_cost: totalApiCost,
    })
    if (!deducted) {
      await log('credits_error', 'warn', `deduct_credits failed after build`, userEmail, {
        userId, pageName, userCharge, totalTokens,
      })
      sendSSE({ type: 'error', error: 'insufficient_credits', message: 'Not enough credits.' })
      clearInterval(heartbeat)
      res.end()
      return
    }

    // Parse response — for continuations, prepend prior parts so extraction sees the full output
    const fullRaw = (isContinuation && partialRaw) ? partialRaw + raw : raw
    let message = 'Done!'
    let code: string | null = null

    // Track file operations for React projects
    const fileOpsApplied: Array<{ action: string; path: string }> = []

    if (planOnly) {
      message = fullRaw
    } else if (projectType === 'react') {
      // --- REACT PROJECT: Parse FILE_OP tags and apply to project_files ---
      const messageMatch = fullRaw.match(/<MESSAGE>([\s\S]*?)<\/MESSAGE>/)
      if (messageMatch) message = messageMatch[1].trim()

      // Parse ADD_PACKAGE tags and save to project_packages
      const addPkgRegex = /<ADD_PACKAGE\s+name="([^"]+)"\s+version="([^"]*)"(?:\s*\/>)/gi
      let pkgMatch: RegExpExecArray | null
      const pkgInserts: Array<{ project_id: string; name: string; version: string }> = []
      while ((pkgMatch = addPkgRegex.exec(fullRaw)) !== null) {
        pkgInserts.push({ project_id: projectId, name: pkgMatch[1].trim(), version: pkgMatch[2].trim() || 'latest' })
      }
      if (pkgInserts.length > 0) {
        await Promise.allSettled(pkgInserts.map(pkg =>
          supabase.from('project_packages').upsert(pkg, { onConflict: 'project_id,name' })
        ))
        sendSSE({ type: 'status', text: `Added ${pkgInserts.length} package(s)` })
      }

      // Parse SERVER_FUNCTION tags and save to project_functions
      const serverFnRegex = /<SERVER_FUNCTION\s+name="([^"]+)">([\s\S]*?)<\/SERVER_FUNCTION>/gi
      let fnMatch: RegExpExecArray | null
      while ((fnMatch = serverFnRegex.exec(fullRaw)) !== null) {
        const fnName = fnMatch[1].trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
        const fnCode = fnMatch[2].trim()
        if (fnName && fnCode && fnCode.length <= 10240) { // 10KB max
          try {
            await supabase.from('project_functions').upsert({
              project_id: projectId, user_id: userId, name: fnName, code: fnCode, updated_at: new Date().toISOString(),
            }, { onConflict: 'project_id,name' })
            sendSSE({ type: 'status', text: `Saved server function: ${fnName}` })
          } catch {}
        }
      }

      // Parse CRON_JOB tags and save to project_cron_jobs
      const cronRegex = /<CRON_JOB\s+name="([^"]+)"\s+schedule="([^"]+)"\s+function="([^"]+)"\s*\/>/gi
      let cronMatch: RegExpExecArray | null
      while ((cronMatch = cronRegex.exec(fullRaw)) !== null) {
        const cronName = cronMatch[1].trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
        const schedule = cronMatch[2].trim()
        const funcName = cronMatch[3].trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
        // Validate cron expression (basic 5-field check)
        if (cronName && schedule.split(/\s+/).length === 5 && funcName) {
          try {
            await supabase.from('project_cron_jobs').upsert({
              project_id: projectId, user_id: userId, name: cronName, schedule, function_name: funcName,
              next_run_at: new Date().toISOString(),
            }, { onConflict: 'project_id,name' })
            sendSSE({ type: 'status', text: `Saved cron job: ${cronName}` })
          } catch {}
        }
      }

      // Parse all FILE_OP tags first, then save in parallel
      const fileOpRegex = /<FILE_OP\s+action="(\w+)"\s+path="([^"]+)"(?:\s*\/>|>([\s\S]*?)<\/FILE_OP>)/gi
      const parsedOps: Array<{ action: string; path: string; content: string }> = []
      let fileOpMatch: RegExpExecArray | null
      while ((fileOpMatch = fileOpRegex.exec(fullRaw)) !== null) {
        const opPath = fileOpMatch[2]
        // SECURITY: validate file path before accepting
        if (!isValidFilePath(opPath)) {
          await log('builder_security', 'warn', `FILE_OP blocked: invalid path "${opPath}"`, userEmail, { userId, projectId, path: opPath })
          continue
        }
        parsedOps.push({ action: fileOpMatch[1].toLowerCase(), path: opPath, content: fileOpMatch[3]?.trim() || '' })
      }

      // Execute all file operations in parallel
      const fileResults = await Promise.allSettled(parsedOps.map(async (op) => {
        if (op.action === 'create' || op.action === 'edit') {
          const ext = op.path.split('.').pop()?.toLowerCase() || 'text'
          const fileType = ['tsx', 'ts'].includes(ext) ? 'ts' : ['jsx', 'js'].includes(ext) ? 'js' : ext
          await saveFile(projectId, userId, op.path, op.content, fileType)
          return { action: op.action, path: op.path }
        } else if (op.action === 'delete') {
          await deleteFile(projectId, op.path)
          return { action: 'delete', path: op.path }
        }
        return null
      }))

      for (let i = 0; i < fileResults.length; i++) {
        const result = fileResults[i]
        if (result.status === 'fulfilled' && result.value) {
          fileOpsApplied.push(result.value)
          sendSSE({ type: 'file_op', action: result.value.action, path: result.value.path })
        } else if (result.status === 'rejected') {
          const op = parsedOps[i]
          await log('builder_error', 'warn', `FILE_OP ${op.action} failed for ${op.path}: ${result.reason?.message}`, userEmail, { userId, projectId, filePath: op.path })
        }
      }

      if (fileOpsApplied.length === 0 && !messageMatch) {
        message = 'Could not parse the response. Please try again.'
      } else if (fileOpsApplied.length > 0) {
        message = message || `Updated ${fileOpsApplied.length} file(s)`
      }
      // code stays null for React projects (files are stored individually)
    } else {
      // --- HTML PROJECT: Parse CODE tags (existing logic) ---
      const messageMatch = fullRaw.match(/<MESSAGE>([\s\S]*?)<\/MESSAGE>/)
      const codeMatch = fullRaw.match(/<CODE>([\s\S]*?)<\/CODE>/)

      if (messageMatch && codeMatch) {
        message = messageMatch[1].trim()
        code = codeMatch[1].trim()
        if (code) code = replaceImagePlaceholders(code)
        if (code && projectId) {
          code = code.replace(/__PROJECT_ID__/g, projectId)
        }
      } else {
        const htmlMatch = fullRaw.match(/<!DOCTYPE html[\s\S]*?<\/html>/i)
        if (htmlMatch) {
          code = htmlMatch[0]
        } else {
          const mdMatch = fullRaw.match(/```(?:html)?\s*\n([\s\S]*?)\n```/)
          if (mdMatch) code = mdMatch[1]
        }
        if (code) code = replaceImagePlaceholders(code)
        if (code && projectId) {
          code = code.replace(/__PROJECT_ID__/g, projectId)
        }

        if (!code) {
          // Auto-retry once on max_tokens truncation
          if (stopReason === 'max_tokens' && retryCount < 1 && !planOnly) {
            sendSSE({ type: 'status', text: 'Response was truncated. Retrying with simpler output...' })
            await log('builder_retry', 'info', `Auto-retrying after max_tokens truncation`, userEmail, { userId, pageName, retryCount })

            const retryStream = client.messages.stream({
              model: settings.chatModel,
              max_tokens: 16000,
              system: systemWithTraining + '\n\nIMPORTANT: Your previous response was truncated because it was too long. Generate a SIMPLER, MORE CONCISE version. Reduce the number of sections, use fewer elements, and keep HTML under 6000 tokens. Focus on core functionality only.',
              messages: apiMessages,
            })

            let retryRaw = ''
            retryStream.on('text', (text) => {
              retryRaw += text
              sendSSE({ type: 'delta', text })
            })

            await retryStream.finalMessage()
            const retryCodeMatch = retryRaw.match(/<CODE>([\s\S]*?)<\/CODE>/)
            const retryHtmlMatch = retryRaw.match(/<!DOCTYPE html[\s\S]*?<\/html>/i)
            if (retryCodeMatch) {
              code = retryCodeMatch[1].trim()
              const retryMsgMatch = retryRaw.match(/<MESSAGE>([\s\S]*?)<\/MESSAGE>/)
              message = retryMsgMatch ? retryMsgMatch[1].trim() : 'Done! (simplified version)'
            } else if (retryHtmlMatch) {
              code = retryHtmlMatch[0]
              message = 'Done! Your page has been updated (simplified version).'
            }
            if (code) code = replaceImagePlaceholders(code)
            if (code && projectId) {
              code = code.replace(/__PROJECT_ID__/g, projectId)
            }
          }

          if (!code) {
            await log('builder_error', 'error',
              `Claude response could not be parsed into HTML (stop_reason: ${stopReason})`,
              userEmail, {
                userId,
                pageName,
                stop_reason: stopReason,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                raw_preview: raw.slice(0, 800),
              }
            )
            message = stopReason === 'max_tokens'
              ? 'The page was too complex to generate in one shot. Try asking for fewer sections at once, or break it into multiple builds.'
              : 'Something went wrong generating the page. Please try again.'
          }
        } else {
          message = code ? 'Done! Your page has been updated.' : message
        }
      }
    }

    const { data: updatedProfile } = await supabase
      .from('profiles').select('credit_balance, gift_balance').eq('id', userId).single()

    // Track daily usage for Platform Analytics (fire-and-forget)
    try {
      const today = new Date().toISOString().split('T')[0]
      await supabase.from('usage_daily').upsert({
        date: today,
        user_id: userId,
        project_id: projectId || null,
        builds: 1,
        tokens_input: inputTokens,
        tokens_output: outputTokens,
        api_cost_anthropic: totalApiCost,
      }, { onConflict: 'date,user_id,project_id' })
    } catch {}

    // Send the final done event with all metadata
    sendSSE({
      type: 'done',
      message: trimmedImagePrompts.length > 0
        ? message + ` (${trimmedImagePrompts.length} image${trimmedImagePrompts.length > 1 ? 's' : ''} generating...)`
        : message,
      code,
      imagePrompts: trimmedImagePrompts, // frontend generates images after build
      tokensUsed: totalTokens,
      apiCost,
      userCharge,
      newBalance: (updatedProfile?.credit_balance || 0) + (updatedProfile?.gift_balance || 0),
      layoutUpdated: projectType === 'html' ? !!layoutMatch : false,
      pagesCreated: projectType === 'html' ? newPages : [],
      // React-specific fields
      fileOps: projectType === 'react' ? fileOpsApplied : undefined,
      projectType,
    })
    clearInterval(heartbeat)
    res.end()
  } catch (err: any) {
    // Clean up heartbeat if it was started
    if (heartbeat) clearInterval(heartbeat)

    // If client disconnected and stream wasn't completed, record as 'stopped' not 'failed'
    if (clientDisconnected && !streamCompleted) {
      const estimatedOutputTokens = Math.ceil((raw || '').length / 4)
      const partialCost = (estimatedOutputTokens / 1000) * settings.outputCostPer1k
      try {
        await supabase.from('transactions').insert({
          user_id: userId, amount: 0, api_cost: partialCost, tokens_used: estimatedOutputTokens,
          type: 'stopped', description: `User stopped ${planOnly ? 'plan' : 'build'}: ${pageName}`,
        })
      } catch (_) {}
      await log('builder_stopped', 'info', `Build stopped by user (outer catch)`, userEmail, { userId, pageName, partialChars: (raw || '').length })
      try { res.end() } catch (_) {}
      return
    }

    const errMsg = err.message || 'Unknown error'
    let userMessage = errMsg

    // Map technical errors to user-friendly messages
    if (errMsg.includes('terminated') || errMsg.includes('aborted') || errMsg.includes('ECONNRESET')) {
      userMessage = 'The build timed out. Try a simpler request or break it into smaller steps.'
    } else if (errMsg.includes('rate_limit') || errMsg.includes('429')) {
      userMessage = 'AI rate limit reached. Please wait a moment and try again.'
    } else if (errMsg.includes('overloaded') || errMsg.includes('529')) {
      userMessage = 'The AI service is temporarily overloaded. Please try again in a minute.'
    } else if (errMsg.includes('invalid_api_key') || errMsg.includes('authentication')) {
      userMessage = 'AI service authentication error. Please contact support.'
    }

    const elapsedSec = ((Date.now() - handlerStart) / 1000).toFixed(1)
    await log('api_error', 'error', `Builder API exception after ${elapsedSec}s: ${errMsg}`, null, {
      userId,
      pageName,
      error: errMsg,
      elapsedSeconds: elapsedSec,
      stack: err.stack?.slice(0, 500),
      imagesRequested: imagePrompts?.length || 0,
      rawChars: (raw || '').length,
      continuationCount,
    })

    // Record failed API cost in transactions so admin can see the loss
    try {
      let failedCost = accumulatedApiCost // at minimum, any prior continuation costs
      let failedTokens = 0
      if (finalMessage?.usage) {
        // We have exact token counts from this call
        failedCost += (finalMessage.usage.input_tokens / 1000) * settings.inputCostPer1k
                    + (finalMessage.usage.output_tokens / 1000) * settings.outputCostPer1k
        failedTokens = finalMessage.usage.input_tokens + finalMessage.usage.output_tokens
      }
      if (failedCost > 0) {
        await supabase.from('transactions').insert({
          user_id: userId, amount: 0, api_cost: failedCost, tokens_used: failedTokens,
          type: 'failed', description: `Build failed: ${pageName} - ${errMsg.slice(0, 80)}`,
        })
      }
    } catch (_) { /* don't let tracking failure block error response */ }

    // If headers already sent (streaming started), send error as SSE event
    if (res.headersSent) {
      sendSSE({ type: 'error', error: userMessage })
      res.end()
    } else {
      res.status(500).json({ error: userMessage })
    }
  }
}
