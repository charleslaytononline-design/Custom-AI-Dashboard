import type { NextApiRequest, NextApiResponse } from 'next'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function parseResponse(raw: string): { message: string; code?: string } {
  // Remove markdown code fences
  let clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
  
  // Try JSON parse
  try {
    const parsed = JSON.parse(clean)
    if (parsed.message) return parsed
  } catch {}

  // Try to find JSON object in mixed content
  try {
    const match = clean.match(/\{[\s\S]*?"message"[\s\S]*?\}(?=\s*$)/)
    if (match) {
      const parsed = JSON.parse(match[0])
      if (parsed.message) return parsed
    }
  } catch {}

  // If raw HTML returned, extract it
  const htmlMatch = raw.match(/<!DOCTYPE html[\s\S]*<\/html>/i)
  if (htmlMatch) {
    return { message: 'Done! Your page has been updated.', code: htmlMatch[0] }
  }

  return { message: raw.slice(0, 500) }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { messages, pageCode, pageName, allPages, planOnly } = req.body
  const pageList = allPages ? allPages.map((p: any) => p.name).join(', ') : 'none'

  const system = planOnly
    ? `You are an AI app builder assistant. The user wants to build something on a page called "${pageName}".
Create a clear, detailed plan of exactly what you will build. List each section, component and feature specifically.
Do NOT write any code. Just the plan in plain text.
Keep it concise — bullet points, max 15 items.`
    : `You are an expert UI engineer inside "Custom AI Dashboard" — a Lovable/Bolt-style AI app builder.

PAGE: "${pageName || 'My Page'}"
OTHER PAGES: ${pageList}
EXISTING CODE:
${pageCode || '<!-- empty -->'}

CRITICAL: You MUST respond with ONLY this exact JSON format — no text before or after:
{"message":"brief description of what you built","code":"FULL HTML HERE"}

The code value must be a complete HTML document. Escape all quotes inside strings properly.

STACK — include ALL of these in every page:
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{brand:{DEFAULT:'#7c6ef7',dark:'#5b50d6'}}}}}</script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

DESIGN:
- Page bg: #0a0a0a
- Cards: bg-[#141414] border border-white/[0.08] rounded-xl
- Sidebar: fixed left-0 top-0 h-screen w-60 bg-[#0f0f0f] border-r border-white/[0.08] z-40
- Topbar: fixed top-0 left-60 right-0 h-14 bg-[#0a0a0a] border-b border-white/[0.08] z-30
- Main content: ml-60 pt-14 p-6 min-h-screen
- Buttons: bg-brand hover:bg-brand-dark text-white rounded-lg px-4 py-2 text-sm font-medium
- Inputs: bg-[#1e1e1e] border border-white/[0.1] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand/60
- Tables: bg-[#141414] border border-white/[0.08] rounded-xl overflow-hidden
- Table header cells: bg-[#1a1a1a] text-white/40 text-xs uppercase tracking-wider px-4 py-3
- Table body rows: border-t border-white/[0.05] text-white/80 text-sm hover:bg-white/[0.02] px-4 py-3
- Stat cards: bg-[#141414] border border-white/[0.08] rounded-xl p-5
- Badges: rounded-full px-2.5 py-0.5 text-xs font-medium
- Green badge: bg-emerald-500/10 text-emerald-400
- Red badge: bg-red-500/10 text-red-400
- Yellow badge: bg-amber-500/10 text-amber-400
- Sidebar nav item inactive: text-white/50 hover:text-white hover:bg-white/[0.05]
- Sidebar nav item active: bg-brand/10 text-brand

ALPINE SIDEBAR PATTERN:
<div x-data="app()" x-init="init()">
  <aside class="fixed left-0 top-0 h-screen w-60 bg-[#0f0f0f] border-r border-white/[0.08] flex flex-col z-40">
    <div class="p-4 border-b border-white/[0.08]">
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-lg bg-brand flex items-center justify-center text-white text-sm font-bold">A</div>
        <span class="text-white font-semibold text-sm">My App</span>
      </div>
    </div>
    <nav class="flex-1 p-2 space-y-0.5">
      <div @click="section='dashboard'" :class="section==='dashboard' ? 'bg-brand/10 text-brand' : 'text-white/50 hover:text-white hover:bg-white/[0.05]'" class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer transition-all">
        <i class="fa-solid fa-gauge w-4 text-center"></i><span>Dashboard</span>
      </div>
    </nav>
  </aside>
  <header class="fixed top-0 left-60 right-0 h-14 bg-[#0a0a0a] border-b border-white/[0.08] flex items-center justify-between px-6 z-30">
    <h1 class="text-white font-medium text-sm" x-text="section"></h1>
    <div class="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center text-brand text-xs font-semibold">U</div>
  </header>
  <main class="ml-60 pt-14 p-6 min-h-screen bg-[#0a0a0a]">
    <div x-show="section==='dashboard'"><!-- content --></div>
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
- Output ONLY the JSON object — nothing before or after
- Always full HTML document
- Use Tailwind classes only — no custom CSS
- Every button must work
- Persist data with localStorage
- Keep all existing features when updating`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system,
      messages,
    })

    const raw = response.content.map((b: any) => b.text || '').join('')
    const parsed = parseResponse(raw)
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens

    res.status(200).json({ ...parsed, tokensUsed })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
