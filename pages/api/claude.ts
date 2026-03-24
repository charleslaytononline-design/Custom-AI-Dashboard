import type { NextApiRequest, NextApiResponse } from 'next'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

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
  maxDuration: 120,
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
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { messages, pageCode, pageName, allPages, planOnly, userId, imageBase64, imageMediaType, projectId } = req.body

  if (!userId) return res.status(401).json({ error: 'Not authenticated' })

  // Look up user profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('credit_balance, role, email, plan_id').eq('id', userId).single()

  if (!profile) {
    await log('api_error', 'error', `Profile not found for userId: ${userId}`, null, { userId, profileError })
    return res.status(401).json({ error: 'User not found' })
  }

  const userEmail = profile.email || null

  // Credit check
  if (profile.credit_balance <= 0) {
    await log('credits_error', 'warn', `Build blocked — insufficient credits`, userEmail, {
      userId, balance: profile.credit_balance, pageName,
    })
    return res.status(402).json({
      error: 'insufficient_credits',
      message: 'You need to purchase credits to continue building.',
      balance: profile.credit_balance,
    })
  }

  // Plan build-limit check (resolves Free plan for null plan_id)
  if (userId && !planOnly && profile.role !== 'admin') {
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
  const pageList = allPages ? allPages.map((p: any) => p.name).join(', ') : 'none'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://login.customaidashboard.com'

  // Fetch project layout_code
  let layoutCode: string | null = null
  if (projectId) {
    const { data: proj } = await supabase.from('projects').select('layout_code').eq('id', projectId).single()
    layoutCode = proj?.layout_code || null
  }

  const hasLayout = !!layoutCode

  const system = planOnly
    ? `You are an AI app builder. The user wants to build something on a page called "${pageName}".
Write a clear bullet-point plan of what you will build. No code. Max 12 bullet points.
If the request involves multiple pages, list which pages you'll create and what each contains.
Respond in plain text only.`
    : `You are an expert UI engineer inside "Custom AI Dashboard" — a professional AI app builder like Lovable.

PROJECT PAGES: ${pageList}
CURRENT PAGE: "${pageName || 'My Page'}"
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
Generate real AI images using Flux. Output BEFORE the CODE block:
<GENERATE_IMAGE>detailed prompt — be specific about style, content, colors, mood, cinematic quality</GENERATE_IMAGE>
<IMAGE_PLACEHOLDER><!-- IMAGE_WILL_BE_INSERTED_HERE --></IMAGE_PLACEHOLDER>
In CODE: <img src="__GENERATED_IMAGE_URL__" alt="description" class="..." />

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

In your CODE, use this pattern for database access:
<script>
const PROJECT_ID = '__PROJECT_ID__'
async function dbQuery(table, action, data) {
  const r = await fetch('/api/db', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({projectId: PROJECT_ID, table, action, data})})
  return r.json()
}
</script>
Use real DB for: forms, CRM records, orders. Use localStorage for: UI state, config, display preferences.

RESPONSE FORMAT:
Output special tags first (<CREATE_PAGE>, <LAYOUT>, <CREATE_TABLE>, <GENERATE_IMAGE>) then:
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
- CRITICAL: Keep HTML output under 12,000 tokens
- Write concise clean code. No comments, no lorem ipsum, no verbose spacing.
- Build core functionality first — skip decorative extras on large requests.`

  try {
    const lastMessage = messages[messages.length - 1]

    let lastContent: any = lastMessage?.content || ''
    if (imageBase64 && imageMediaType) {
      lastContent = [
        { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageBase64 } },
        { type: 'text', text: typeof lastMessage?.content === 'string' ? lastMessage.content : 'See the image above.' },
      ]
    }

    const rawHistory = messages.slice(0, -1).map((m: any) => ({ role: m.role, content: m.content }))
    // Cap to last 8 history messages to prevent context overflow (fixes 116-token parse failures)
    const cappedHistory = rawHistory.length > 8 ? rawHistory.slice(-8) : rawHistory
    const firstUserIdx = cappedHistory.findIndex((m: any) => m.role === 'user')
    const safeHistory = firstUserIdx > 0 ? cappedHistory.slice(firstUserIdx) : cappedHistory

    const apiMessages = [
      ...safeHistory,
      { role: lastMessage?.role || 'user', content: lastContent },
    ]

    const response = await client.messages.create({
      model: settings.chatModel,
      max_tokens: 16000,  // SDK requires streaming above ~30K tokens; 16K is safe and sufficient with concise prompting
      system,
      messages: apiMessages,
    })

    const raw = response.content.map((b: any) => b.text || '').join('')
    const inputTokens = response.usage.input_tokens
    const outputTokens = response.usage.output_tokens
    const totalTokens = inputTokens + outputTokens
    const apiCost = (inputTokens / 1000) * settings.inputCostPer1k + (outputTokens / 1000) * settings.outputCostPer1k
    const userCharge = apiCost * settings.markupMultiplier
    const stopReason = response.stop_reason

    // Check if image generation is needed
    const imagePromptMatch = raw.match(/<GENERATE_IMAGE>([\s\S]*?)<\/GENERATE_IMAGE>/i)
    let generatedImageUrl: string | null = null

    if (imagePromptMatch) {
      const imagePrompt = imagePromptMatch[1].trim()
      try {
        const imgRes = await fetch(`${appUrl}/api/generate-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: imagePrompt, userId }),
        })
        const imgData = await imgRes.json()
        if (imgData.url) {
          generatedImageUrl = imgData.url
        } else {
          // generate-image already logged the specific Replicate error — add a build-level log too
          await log('builder_error', 'warn', `Image generation failed during build: ${imgData.detail || imgData.error || 'unknown'}`, userEmail, {
            userId, pageName, imagePrompt: imagePrompt.slice(0, 200), error: imgData.detail || imgData.error,
          })
        }
      } catch (imgErr: any) {
        await log('builder_error', 'warn', `Image generation network error: ${imgErr.message}`, userEmail, {
          userId, pageName, error: imgErr.message,
        })
      }
    }

    // Handle <CREATE_TABLE> tags — create real tables in Clients DB (supports multiple per build)
    const tableDefsFound: RegExpExecArray[] = []
    const tableRegex = /<CREATE_TABLE>([\s\S]*?)<\/CREATE_TABLE>/gi
    let tableMatch: RegExpExecArray | null
    while ((tableMatch = tableRegex.exec(raw)) !== null) tableDefsFound.push(tableMatch)
    if (tableDefsFound.length > 0 && clientsDb && projectId && !planOnly) {
      const schemaName = `proj_${projectId}`
      const planId = profile.plan_id || null
      const { data: plan } = planId
        ? await supabase.from('plans').select('max_tables_per_project').eq('id', planId).single()
        : await supabase.from('plans').select('max_tables_per_project').eq('price_monthly', 0).order('sort_order', { ascending: true }).limit(1).single()
      const { data: usageRow } = await clientsDb.from('schema_usage').select('table_count').eq('project_id', projectId).single()
      let currentCount = usageRow?.table_count || 0
      const tableLimit = plan?.max_tables_per_project ?? 5
      let tablesCreated = 0

      for (const match of tableDefsFound) {
        if (currentCount >= tableLimit) {
          await log('builder_error', 'warn', `Table limit reached (${currentCount}/${tableLimit}), skipping remaining tables`, userEmail, { userId, projectId })
          break
        }
        try {
          const tableDef = JSON.parse(match[1].trim())
          await clientsDb.rpc('create_project_table', { schema_name: schemaName, table_def: tableDef })
          currentCount++
          tablesCreated++
        } catch (tableErr: any) {
          await log('builder_error', 'warn', `CREATE_TABLE failed: ${tableErr.message}`, userEmail, { userId, projectId })
        }
      }

      if (tablesCreated > 0) {
        await clientsDb.from('schema_registry').upsert(
          { project_id: projectId, user_id: userId, schema_name: schemaName, last_accessed_at: new Date().toISOString() },
          { onConflict: 'project_id' }
        )
        await clientsDb.from('schema_usage').upsert(
          { project_id: projectId, user_id: userId, schema_name: schemaName, table_count: currentCount, sampled_at: new Date().toISOString() },
          { onConflict: 'project_id' }
        )
      }
    }

    // Handle <LAYOUT> tag — save shared layout to project
    const layoutMatch = raw.match(/<LAYOUT>([\s\S]*?)<\/LAYOUT>/i)
    if (layoutMatch && projectId && !planOnly) {
      const newLayout = layoutMatch[1].trim()
      await supabase.from('projects').update({ layout_code: newLayout }).eq('id', projectId)
    }

    // Handle <CREATE_PAGE> tags — create new pages in the project
    const pageRegex = /<CREATE_PAGE>([\s\S]*?)<\/CREATE_PAGE>/gi
    const newPages: string[] = []
    let pageMatch: RegExpExecArray | null
    while ((pageMatch = pageRegex.exec(raw)) !== null) {
      const match = pageMatch
      const newPageName = match[1].trim()
      if (!newPageName) continue
      // Check if page already exists
      const existingNames = (allPages || []).map((p: any) => p.name.toLowerCase())
      if (existingNames.includes(newPageName.toLowerCase())) continue
      // Don't create a page with the same name as the current page
      if (newPageName.toLowerCase() === (pageName || '').toLowerCase()) continue
      newPages.push(newPageName)
    }
    if (newPages.length > 0 && projectId && !planOnly) {
      for (const name of newPages) {
        await supabase.from('pages').insert({
          project_id: projectId,
          user_id: userId,
          name,
          code: `<!-- Page: ${name} — build this page next -->`,
        })
      }
    }

    // If image generation failed, replace the placeholder with a dark grey fallback
    // so the page renders cleanly instead of showing a broken image icon
    const imageFallback = generatedImageUrl
      ? generatedImageUrl
      : 'https://placehold.co/1024x768/141414/444444?text=Image+not+available'

    // Deduct credits from everyone including admin
    const { data: deducted } = await supabase.rpc('deduct_credits', {
      p_user_id: userId,
      p_amount: userCharge,
      p_description: `AI build: ${pageName}`,
      p_tokens_used: totalTokens,
      p_api_cost: apiCost,
    })
    if (!deducted) {
      await log('credits_error', 'warn', `deduct_credits failed after build`, userEmail, {
        userId, pageName, userCharge, totalTokens,
      })
      return res.status(402).json({ error: 'insufficient_credits', message: 'Not enough credits.' })
    }

    // Parse response
    let message = 'Done!'
    let code: string | null = null

    if (planOnly) {
      message = raw
    } else {
      const messageMatch = raw.match(/<MESSAGE>([\s\S]*?)<\/MESSAGE>/)
      const codeMatch = raw.match(/<CODE>([\s\S]*?)<\/CODE>/)

      if (messageMatch && codeMatch) {
        message = messageMatch[1].trim()
        code = codeMatch[1].trim()
        if (generatedImageUrl && code) {
          code = code.replace(/__GENERATED_IMAGE_URL__/g, imageFallback)
        }
        if (code && projectId) {
          code = code.replace(/__PROJECT_ID__/g, projectId)
        }
      } else {
        // Fallback 1: raw <!DOCTYPE html> block
        const htmlMatch = raw.match(/<!DOCTYPE html[\s\S]*?<\/html>/i)
        if (htmlMatch) {
          code = htmlMatch[0]
        } else {
          // Fallback 2: markdown ```html ... ``` block
          const mdMatch = raw.match(/```(?:html)?\s*\n([\s\S]*?)\n```/)
          if (mdMatch) code = mdMatch[1]
        }
        if (generatedImageUrl && code) {
          code = code.replace(/__GENERATED_IMAGE_URL__/g, imageFallback)
        }
        if (code && projectId) {
          code = code.replace(/__PROJECT_ID__/g, projectId)
        }

        if (!code) {
          // Log the failure with the raw Claude response for debugging
          await log('builder_error', 'error',
            `Claude response could not be parsed into HTML (stop_reason: ${stopReason})`,
            userEmail, {
              userId,
              pageName,
              stop_reason: stopReason,
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              raw_preview: raw.slice(0, 800),  // first 800 chars of Claude's response for debugging
            }
          )
          message = stopReason === 'max_tokens'
            ? 'The page was too complex to generate in one shot. Try asking for fewer sections at once, or break it into multiple builds.'
            : 'Something went wrong generating the page. Please try again.'
        } else {
          message = code ? 'Done! Your page has been updated.' : message
        }
      }
    }

    const { data: updatedProfile } = await supabase
      .from('profiles').select('credit_balance').eq('id', userId).single()

    res.status(200).json({
      message: generatedImageUrl ? message + ' (AI image generated ✓)' : message,
      code,
      tokensUsed: totalTokens,
      apiCost,
      userCharge,
      imageGenerated: !!generatedImageUrl,
      newBalance: updatedProfile?.credit_balance || 0,
      layoutUpdated: !!layoutMatch,
      pagesCreated: newPages,
    })
  } catch (err: any) {
    // Log the exception with full details
    await log('api_error', 'error', `Builder API exception: ${err.message}`, null, {
      userId,
      pageName,
      error: err.message,
      stack: err.stack?.slice(0, 500),
    })
    res.status(500).json({ error: err.message })
  }
}
