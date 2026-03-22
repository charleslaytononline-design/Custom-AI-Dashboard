import type { NextApiRequest, NextApiResponse } from 'next'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { messages, pageCode, pageName, allPages, planOnly } = req.body
  const pageList = allPages ? allPages.map((p: any) => p.name).join(', ') : 'none'

  const system = planOnly
    ? `You are an AI app builder. The user wants to build something on a page called "${pageName}".
Write a clear bullet-point plan of what you will build. No code. Max 12 bullet points.
Respond in plain text only.`
    : `You are an expert UI engineer inside "Custom AI Dashboard" — an AI app builder like Lovable.

PAGE: "${pageName || 'My Page'}"
OTHER PAGES: ${pageList}
EXISTING CODE:
${pageCode || '<!-- empty -->'}

INSTRUCTIONS:
Build exactly what the user asks. Return your response in this format:

<MESSAGE>Brief description of what you built</MESSAGE>
<CODE>
<!DOCTYPE html>
... complete HTML page here ...
</html>
</CODE>

STACK — include in every page:
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
- Primary text: text-white
- Muted text: text-white/50
- Buttons primary: bg-brand hover:bg-brand-dark text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer
- Inputs: bg-[#1e1e1e] border border-white/[0.1] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand/60
- Table wrapper: bg-[#141414] border border-white/[0.08] rounded-xl overflow-hidden w-full
- Thead: bg-[#1a1a1a] text-white/40 text-xs uppercase tracking-wider
- Th/Td: px-4 py-3 text-left
- Tbody tr: border-t border-white/[0.05] text-white/80 text-sm hover:bg-white/[0.02]
- Stat card: bg-[#141414] border border-white/[0.08] rounded-xl p-5
- Green badge: bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-0.5 rounded-full font-medium
- Red badge: bg-red-500/10 text-red-400 text-xs px-2.5 py-0.5 rounded-full font-medium
- Yellow badge: bg-amber-500/10 text-amber-400 text-xs px-2.5 py-0.5 rounded-full font-medium
- Sidebar nav inactive: flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer text-white/50 hover:text-white hover:bg-white/[0.05] transition-all
- Sidebar nav active: flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer bg-brand/10 text-brand

ALPINE PATTERN for multi-section apps:
<div x-data="app()" x-init="init()">
  <aside class="fixed left-0 top-0 h-screen w-60 bg-[#0f0f0f] border-r border-white/[0.08] flex flex-col z-40">
    <div class="p-4 border-b border-white/[0.08] flex items-center gap-2.5">
      <div class="w-8 h-8 rounded-lg bg-brand flex items-center justify-center text-white text-sm font-bold">A</div>
      <span class="text-white font-semibold text-sm">My App</span>
    </div>
    <nav class="flex-1 p-2 space-y-0.5 overflow-y-auto">
      <div @click="section='dashboard'" :class="section==='dashboard' ? 'bg-brand/10 text-brand' : 'text-white/50 hover:text-white hover:bg-white/[0.05]'" class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm cursor-pointer transition-all">
        <i class="fa-solid fa-gauge w-4 text-center"></i><span>Dashboard</span>
      </div>
    </nav>
  </aside>
  <header class="fixed top-0 left-60 right-0 h-14 bg-[#0a0a0a] border-b border-white/[0.08] flex items-center justify-between px-6 z-30">
    <h1 class="text-white font-medium text-sm" x-text="section.charAt(0).toUpperCase()+section.slice(1)"></h1>
    <div class="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center text-brand text-xs font-semibold">U</div>
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
    showModal: false,
    init() {
      this.items = JSON.parse(localStorage.getItem('appItems') || '[]')
      this.$watch('items', v => localStorage.setItem('appItems', JSON.stringify(v)))
    }
  }
}
</script>

RULES:
- Always output the COMPLETE HTML document
- Use Tailwind classes only — no custom CSS blocks
- Every button must work — no dead UI
- Use realistic sample data, not lorem ipsum
- Persist all data to localStorage
- Keep ALL existing features when updating — only add, never remove`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system,
      messages,
    })

    const raw = response.content.map((b: any) => b.text || '').join('')
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens

    if (planOnly) {
      return res.status(200).json({ message: raw, tokensUsed })
    }

    // Extract using XML tags — much more reliable than JSON parsing
    const messageMatch = raw.match(/<MESSAGE>([\s\S]*?)<\/MESSAGE>/i)
    const codeMatch = raw.match(/<CODE>([\s\S]*?)<\/CODE>/i)

    if (messageMatch && codeMatch) {
      return res.status(200).json({
        message: messageMatch[1].trim(),
        code: codeMatch[1].trim(),
        tokensUsed
      })
    }

    // Fallback: try to find raw HTML
    const htmlMatch = raw.match(/<!DOCTYPE html[\s\S]*<\/html>/i)
    if (htmlMatch) {
      return res.status(200).json({
        message: 'Done! Your page has been updated.',
        code: htmlMatch[0],
        tokensUsed
      })
    }

    // Last resort
    return res.status(200).json({ message: raw.slice(0, 300), tokensUsed })

  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}