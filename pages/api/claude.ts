import type { NextApiRequest, NextApiResponse } from 'next'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Increase body size limit for image uploads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}

async function getSettings() {
  const { data } = await supabase.from('settings').select('*')
  const map: Record<string, number> = {}
  data?.forEach((s: any) => { map[s.key] = parseFloat(s.value) })
  return {
    markupMultiplier: map['markup_multiplier'] || 3.0,
    inputCostPer1k: map['input_cost_per_1k'] || 0.003,
    outputCostPer1k: map['output_cost_per_1k'] || 0.015,
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { messages, pageCode, pageName, allPages, planOnly, userId, imageBase64, imageMediaType } = req.body

  if (!userId) return res.status(401).json({ error: 'Not authenticated' })

  const { data: profile } = await supabase
    .from('profiles')
    .select('credit_balance, role')
    .eq('id', userId)
    .single()

  if (!profile) return res.status(401).json({ error: 'User not found' })

  const isAdmin = profile.role === 'admin'

  if (!isAdmin && profile.credit_balance <= 0) {
    return res.status(402).json({
      error: 'insufficient_credits',
      message: 'You need to purchase credits to continue building.',
      balance: profile.credit_balance
    })
  }

  const settings = await getSettings()
  const pageList = allPages ? allPages.map((p: any) => p.name).join(', ') : 'none'

  const system = planOnly
    ? `You are an AI app builder. The user wants to build something on a page called "${pageName}".
Write a clear bullet-point plan of what you will build. No code. Max 12 bullet points.
Respond in plain text only.`
    : `You are an expert UI engineer inside "Custom AI Dashboard" — an AI app builder like Lovable.

PAGE: "${pageName || 'My Page'}"
OTHER PAGES: ${pageList}

CURRENT PAGE CODE:
\`\`\`html
${pageCode || '<!-- empty page -->'}
\`\`\`

You can see the current page code above. Make precise changes while keeping everything intact.
If the user sends a screenshot, use it to understand what they want visually.

Return your response in this exact format — nothing before or after:

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
- Green badge: bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-0.5 rounded-full
- Red badge: bg-red-500/10 text-red-400 text-xs px-2.5 py-0.5 rounded-full
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
- Output ONLY the XML format above
- Always output COMPLETE HTML document
- Use Tailwind classes only
- Every button must work
- Persist data to localStorage
- Keep ALL existing features when updating`

  try {
    const lastMessage = messages[messages.length - 1]

    let lastContent: any = lastMessage?.content || ''
    if (imageBase64 && imageMediaType) {
      lastContent = [
        {
          type: 'image',
          source: { type: 'base64', media_type: imageMediaType, data: imageBase64 }
        },
        { type: 'text', text: typeof lastMessage?.content === 'string' ? lastMessage.content : 'See the image above.' }
      ]
    }

    const apiMessages = [
      ...messages.slice(0, -1).map((m: any) => ({ role: m.role, content: m.content })),
      { role: lastMessage?.role || 'user', content: lastContent }
    ]

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system,
      messages: apiMessages,
    })

    const raw = response.content.map((b: any) => b.text || '').join('')
    const inputTokens = response.usage.input_tokens
    const outputTokens = response.usage.output_tokens
    const totalTokens = inputTokens + outputTokens
    const apiCost = (inputTokens / 1000) * settings.inputCostPer1k + (outputTokens / 1000) * settings.outputCostPer1k
    const userCharge = apiCost * settings.markupMultiplier

    if (isAdmin) {
      await supabase.from('transactions').insert({
        user_id: userId,
        type: 'usage',
        amount: -userCharge,
        description: `AI build (admin): ${pageName}`,
        tokens_used: totalTokens,
        api_cost: apiCost,
      })
    } else {
      const { data: deducted } = await supabase.rpc('deduct_credits', {
        p_user_id: userId,
        p_amount: userCharge,
        p_description: `AI build: ${pageName}`,
        p_tokens_used: totalTokens,
        p_api_cost: apiCost,
      })
      if (!deducted) {
        return res.status(402).json({ error: 'insufficient_credits', message: 'Not enough credits.' })
      }
    }

    let message = 'Done!'
    let code = null

    if (planOnly) {
      message = raw
    } else {
      const messageMatch = raw.match(/<MESSAGE>([\s\S]*?)<\/MESSAGE>/i)
      const codeMatch = raw.match(/<CODE>([\s\S]*?)<\/CODE>/i)
      if (messageMatch && codeMatch) {
        message = messageMatch[1].trim()
        code = codeMatch[1].trim()
      } else {
        const htmlMatch = raw.match(/<!DOCTYPE html[\s\S]*<\/html>/i)
        if (htmlMatch) code = htmlMatch[0]
        message = 'Done! Your page has been updated.'
      }
    }

    const { data: updatedProfile } = await supabase
      .from('profiles').select('credit_balance').eq('id', userId).single()

    res.status(200).json({
      message,
      code,
      tokensUsed: totalTokens,
      apiCost,
      userCharge,
      newBalance: isAdmin ? 'admin' : (updatedProfile?.credit_balance || 0),
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}