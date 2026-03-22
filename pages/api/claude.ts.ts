import type { NextApiRequest, NextApiResponse } from 'next'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { messages, pageCode, pageName, allPages, planOnly } = req.body

  const pageList = allPages ? allPages.map((p: any) => p.name).join(', ') : 'none yet'
  const existingCode = pageCode || '<!-- empty -->'

  const system = planOnly
    ? `You are an AI app planner. The user wants to build something. Create a clear, detailed plan describing exactly what you will build — sections, features, components, data. Be specific and friendly. Return plain text, no JSON, no code.`
    : `You are an expert UI engineer inside "Custom AI Dashboard" — like Lovable/Bolt.new. Build complete professional web apps from chat commands.

CURRENT PAGE: "${pageName || 'My Page'}"
OTHER PAGES: ${pageList}
EXISTING CODE: ${existingCode}

CRITICAL: You MUST return ONLY a JSON object. No text before or after. No markdown. No backticks. Just the raw JSON.

The JSON must be exactly this shape:
{"message":"short description of what you built","code":"<!DOCTYPE html>.....</html>"}

The "code" value must be the complete HTML page as a single JSON string. Escape all special characters properly in the JSON string.

STACK — include these in every page:
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{brand:{DEFAULT:'#7c6ef7',dark:'#5b50d6'}}}}}</script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

DESIGN:
- Page bg: bg-[#0a0a0a], cards: bg-[#141414] border border-white/[0.08] rounded-xl
- Sidebar: fixed left-0 top-0 h-screen w-60 bg-[#0f0f0f] border-r border-white/[0.08]
- Topbar: fixed top-0 left-60 right-0 h-14 bg-[#0a0a0a] border-b border-white/[0.08]
- Main content: ml-60 pt-14 p-6 min-h-screen bg-[#0a0a0a]
- Text: text-white, muted: text-white/50
- Buttons: bg-brand hover:bg-brand-dark text-white rounded-lg px-4 py-2 text-sm font-medium
- Inputs: bg-[#1e1e1e] border border-white/[0.1] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand/60
- Tables: bg-[#141414] rounded-xl overflow-hidden — thead bg-[#1a1a1a] text-white/40 text-xs uppercase — tbody border-t border-white/[0.05] hover:bg-white/[0.02]
- Stat cards: bg-[#141414] border border-white/[0.08] rounded-xl p-5
- Badges: rounded-full px-2.5 py-0.5 text-xs — green: bg-emerald-500/10 text-emerald-400 — red: bg-red-500/10 text-red-400
- Sidebar items active: bg-brand/10 text-brand — inactive: text-white/50 hover:text-white hover:bg-white/[0.05]
- Use Font Awesome icons: <i class="fa-solid fa-house"></i>

ALPINE.JS — use for all interactivity:
<div x-data="{ section:'dashboard', items: JSON.parse(localStorage.getItem('items')||'[]'), init(){ this.$watch('items', v => localStorage.setItem('items', JSON.stringify(v))) } }">

RULES:
- Return ONLY raw JSON — no backticks, no markdown, no extra text
- Complete HTML document every time
- Use Tailwind classes only — no custom CSS
- All data persisted to localStorage
- Every button works, every form submits, every delete deletes
- Use realistic mock data
- Keep all existing features when updating`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system,
      messages,
    })

    const raw = response.content.map((b: any) => b.text || '').join('')
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens

    // Plan mode — return text directly
    if (planOnly) {
      return res.status(200).json({ message: raw, tokensUsed })
    }

    // Build mode — robust JSON extraction
    let parsed: any = null

    // Strategy 1: direct JSON parse after stripping markdown fences
    try {
      const clean = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim()
      parsed = JSON.parse(clean)
    } catch {}

    // Strategy 2: extract JSON object with regex
    if (!parsed) {
      try {
        const match = raw.match(/\{[\s\S]*"message"[\s\S]*"code"[\s\S]*\}/)
        if (match) parsed = JSON.parse(match[0])
      } catch {}
    }

    // Strategy 3: extract HTML directly if AI forgot to wrap in JSON
    if (!parsed) {
      const htmlMatch = raw.match(/<!DOCTYPE html[\s\S]*?<\/html>/i)
      if (htmlMatch) {
        parsed = { message: 'Your page has been updated.', code: htmlMatch[0] }
      }
    }

    // Strategy 4: fallback
    if (!parsed) {
      parsed = { message: 'Done.', code: raw }
    }

    res.status(200).json({ ...parsed, tokensUsed })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
