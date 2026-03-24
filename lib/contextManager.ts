/**
 * Smart context management for AI builder.
 * Reduces token usage by sending only relevant context to Claude.
 */

interface PageInfo {
  name: string
  code: string
}

/**
 * Build a compact page summary for context.
 * Only includes full code for the active page and any pages mentioned in the prompt.
 * Other pages get a name + short preview.
 */
export function buildPageContext(
  activePage: { name: string; code: string },
  allPages: PageInfo[],
  userPrompt: string,
): string {
  const mentionedPages = allPages.filter(p => {
    if (p.name === activePage.name) return false
    // Check if user mentions this page by name (case-insensitive)
    return userPrompt.toLowerCase().includes(p.name.toLowerCase())
  })

  const otherPages = allPages.filter(p =>
    p.name !== activePage.name && !mentionedPages.some(m => m.name === p.name)
  )

  let context = `CURRENT PAGE: "${activePage.name}"\n`
  context += `PROJECT PAGES: ${allPages.map(p => p.name).join(', ')}\n`

  if (mentionedPages.length > 0) {
    context += '\nREFERENCED PAGES:\n'
    for (const p of mentionedPages) {
      context += `--- ${p.name} ---\n${p.code.slice(0, 2000)}\n`
    }
  }

  if (otherPages.length > 0) {
    context += '\nOTHER PAGES (summaries):\n'
    for (const p of otherPages) {
      const preview = p.code.replace(/\s+/g, ' ').slice(0, 100)
      context += `- ${p.name}: ${preview}...\n`
    }
  }

  return context
}

/**
 * Summarize long chat history into a compact context paragraph.
 * When history exceeds the threshold, keep only last N messages
 * and prepend a summary of earlier messages.
 */
export function compactHistory(
  messages: Array<{ role: string; content: string }>,
  keepLast: number = 4,
): { summary: string | null; recentMessages: Array<{ role: string; content: string }> } {
  if (messages.length <= keepLast + 2) {
    return { summary: null, recentMessages: messages }
  }

  const olderMessages = messages.slice(0, -keepLast)
  const recentMessages = messages.slice(-keepLast)

  // Build a compact summary of older messages
  const summaryParts: string[] = []
  for (const msg of olderMessages) {
    const content = typeof msg.content === 'string' ? msg.content : '[image/media]'
    const truncated = content.slice(0, 150).replace(/\s+/g, ' ')
    summaryParts.push(`${msg.role}: ${truncated}`)
  }

  const summary = `Previous conversation summary (${olderMessages.length} messages):\n${summaryParts.join('\n')}`

  return { summary, recentMessages }
}
