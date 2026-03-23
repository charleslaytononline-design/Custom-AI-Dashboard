import type { NextApiRequest, NextApiResponse } from 'next'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
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

  const { messages, pageCode, pageName, allPages, planOnly, userId, imageBase64, imageMediaType } = req.body

  if (!userId) return res.status(401).json({ error: 'Not authenticated' })

  // Look up user profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('credit_balance, role, email').eq('id', userId).single()

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

  const settings = await getSettings()
  const pageList = allPages ? allPages.map((p: any) => p.name).join(', ') : 'none'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://login.customaidashboard.com'

  const system = planOnly
    ? `You are an AI app builder. The user wants to build something on a page called "${pageName}".
Write a clear bullet-point plan of what you will build. No code. Max 12 bullet points.
Respond in plain text only.`
    : `You are an expert UI engineer inside "Custom AI Dashboard" — a professional AI app builder like Lovable.

PAGE: "${pageName || 'My Page'}"
OTHER PAGES: ${pageList}

CURRENT PAGE CODE:
\`\`\`html
${pageCode || '<!-- empty page -->'}
\`\`\`

IMAGE GENERATION CAPABILITY:
You can generate real AI images using Flux when users need images in their pages.
When you need an image, output a special tag BEFORE the CODE block:

<GENERATE_IMAGE>detailed description of the image needed, be very specific about style, content, colors, mood</GENERATE_IMAGE>
<IMAGE_PLACEHOLDER><!-- IMAGE_WILL_BE_INSERTED_HERE --></IMAGE_PLACEHOLDER>

Then in your CODE, use this exact placeholder where the image should appear:
<img src="__GENERATED_IMAGE_URL__" alt="description" class="..." />

The platform will automatically generate the image with Flux AI and replace __GENERATED_IMAGE_URL__ with the real URL.

When to generate images:
- Hero sections needing a visual (robots, tech, business, people, landscapes)
- Product mockups or illustrations
- Background images
- Any time the user asks for a specific image or visual
- When the current code has a boring placeholder div where an image should be

For the image prompt, be extremely detailed and specific:
BAD: "AI robot"
GOOD: "Photorealistic glowing cyan AI humanoid robot, transparent body showing circuit patterns, standing in front of multiple holographic screens showing data, dark background with teal ambient lighting, cinematic quality, 8k resolution"

INSTRUCTIONS:
Return your response in this exact format:

<MESSAGE>Brief description of what you built or changed</MESSAGE>
<CODE>
<!DOCTYPE html>
... complete HTML page here ...
</html>
</CODE>

STACK — always include ALL of these:
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{brand:{DEFAULT:'#7c6ef7',dark:'#5b50d6'}}}}}</script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

DESIGN:
- Page bg: #0a0a0a
- Cards: bg-[#141414] border border-white/[0.08] rounded-xl p-5
- Sidebar: fixed left-0 top-0 h-screen w-60 bg-[#0f0f0f] border-r border-white/[0.08] z-40
- Topbar: fixed top-0 left-60 right-0 h-14 bg-[#0a0a0a] border-b border-white/[0.08] z-30 flex items-center px-6
- Main: ml-60 pt-14 p-6 min-h-screen bg-[#0a0a0a]
- Buttons: bg-brand hover:bg-brand-dark text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer
- Inputs: bg-[#1e1e1e] border border-white/[0.1] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand/60
- Table: bg-[#141414] border border-white/[0.08] rounded-xl overflow-hidden
- Green badge: bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-0.5 rounded-full font-medium
- Red badge: bg-red-500/10 text-red-400 text-xs px-2.5 py-0.5 rounded-full font-medium
- Sidebar nav inactive: text-white/50 hover:text-white hover:bg-white/[0.05]
- Sidebar nav active: bg-brand/10 text-brand

ALPINE SIDEBAR PATTERN:
<div x-data="app()" x-init="init()">
  <aside class="fixed left-0 top-0 h-screen w-60 bg-[#0f0f0f] border-r border-white/[0.08] flex flex-col z-40">
    <div class="p-4 border-b border-white/[0.08] flex items-center gap-2.5">
      <div class="w-8 h-8 rounded-lg bg-brand flex items-center justify-center text-white text-sm font-bold">A</div>
      <span class="text-white font-semibold text-sm">My App</span>
    </div>
    <nav class="flex-1 p-2 space-y-0.5">
      <div @click="section='dashboard'" :class="section==='dashboard'?'bg-brand/10 text-brand':'text-white/50 hover:text-white hover:bg-white/[0.05]'" class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer transition-all">
        <i class="fa-solid fa-gauge w-4 text-center"></i><span>Dashboard</span>
      </div>
    </nav>
  </aside>
  <header class="fixed top-0 left-60 right-0 h-14 bg-[#0a0a0a] border-b border-white/[0.08] flex items-center justify-between px-6 z-30">
    <h1 class="text-white font-medium text-sm" x-text="section.charAt(0).toUpperCase()+section.slice(1)"></h1>
  </header>
  <main class="ml-60 pt-14 p-6 min-h-screen bg-[#0a0a0a]">
    <div x-show="section==='dashboard'">...</div>
  </main>
</div>
<script>
function app() {
  return {
    section: 'dashboard',
    items: [],
    init() {
      this.items = JSON.parse(localStorage.getItem('items') || '[]')
      this.$watch('items', v => localStorage.setItem('items', JSON.stringify(v)))
    }
  }
}
</script>

RULES:
- Output ONLY the XML format — nothing before MESSAGE or after CODE closing tag
- Always output COMPLETE HTML document
- Use Tailwind classes only
- Every button must work
- Persist data to localStorage
- Keep ALL existing features when updating
- When generating images, make the prompt extremely detailed and cinematic
- Keep your total output under 28,000 tokens. Use concise Tailwind classes; avoid verbose inline comments in the HTML.
- If the page is very complex, prioritise working functionality over decorative extras`

  try {
    const lastMessage = messages[messages.length - 1]

    let lastContent: any = lastMessage?.content || ''
    if (imageBase64 && imageMediaType) {
      lastContent = [
        { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageBase64 } },
        { type: 'text', text: typeof lastMessage?.content === 'string' ? lastMessage.content : 'See the image above.' },
      ]
    }

    const apiMessages = [
      ...messages.slice(0, -1).map((m: any) => ({ role: m.role, content: m.content })),
      { role: lastMessage?.role || 'user', content: lastContent },
    ]

    const response = await client.messages.create({
      model: settings.chatModel,
      max_tokens: 32000,  // Increased from 16000 — complex full-page HTML with multiple sections needs more room
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
