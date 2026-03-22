import type { NextApiRequest, NextApiResponse } from 'next'
import Anthropic from 'anthropic'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { messages, pageCode, pageName } = req.body

  const system = `You are an AI builder inside "Custom AI Dashboard" — a platform where users build their own web apps using AI chat commands.

The user is currently editing a page called: "${pageName || 'My Page'}"

Current page HTML code:
\`\`\`html
${pageCode || '<p>Empty page — build something!</p>'}
\`\`\`

Your job is to modify or build this page based on the user's instructions.

IMPORTANT RULES:
- Always respond with valid JSON only. No prose outside JSON.
- Format:
{
  "message": "Short friendly message to user explaining what you did",
  "code": "The COMPLETE new HTML for the page (full document with inline CSS and JS)"
}
- The code must be a complete self-contained HTML page with all styles inline or in a <style> tag.
- Use modern, clean design. Dark theme preferred (#0f0f0f background, white text).
- Make it fully functional — forms, buttons, tables, charts — all working with vanilla JS.
- If the user asks for data storage, use localStorage in the iframe.
- Never use external APIs that need keys.
- Always return the FULL page code, not just the changed parts.
- Be creative and make it look professional.`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system,
      messages,
    })

    const raw = response.content.map((b: any) => b.text || '').join('')
    let parsed
    try {
      const clean = raw.replace(/```json|```/g, '').trim()
      parsed = JSON.parse(clean)
    } catch {
      parsed = { message: 'Done! Here is your updated page.', code: raw }
    }

    // Track token usage
    const tokensUsed = response.usage.input_tokens + response.usage.output_tokens

    res.status(200).json({ ...parsed, tokensUsed })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
