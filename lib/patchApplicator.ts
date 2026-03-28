/**
 * Patch applicator for diff-based file edits.
 * Parses <<<< SEARCH / ==== REPLACE / >>>> blocks and applies them sequentially.
 */

export interface PatchBlock {
  search: string
  replace: string
}

export interface PatchResult {
  success: boolean
  content: string
  appliedCount: number
  failedCount: number
  failures: string[]
}

/**
 * Parse patch content into individual search/replace blocks.
 * Format:
 *   <<<< SEARCH
 *   exact text to find
 *   ==== REPLACE
 *   replacement text
 *   >>>>
 */
export function parsePatchBlocks(patchContent: string): PatchBlock[] {
  const blocks: PatchBlock[] = []
  const blockRegex = /<<<< SEARCH\n([\s\S]*?)\n==== REPLACE\n([\s\S]*?)\n>>>>/g
  let match: RegExpExecArray | null

  while ((match = blockRegex.exec(patchContent)) !== null) {
    const search = match[1]
    const replace = match[2]
    if (search.length > 0) {
      blocks.push({ search, replace })
    }
  }

  return blocks
}

/**
 * Normalize whitespace for fuzzy matching fallback.
 * Collapses runs of spaces/tabs (but preserves newlines and indentation structure).
 */
function normalizeForMatch(text: string): string {
  return text
    .split('\n')
    .map(line => line.trimEnd().replace(/\t/g, '  '))
    .join('\n')
}

/**
 * Apply patch blocks sequentially to file content.
 * Each block sees the result of previous blocks.
 * Tries exact match first, whitespace-normalized fallback second.
 * Replaces first occurrence only.
 */
export function applyPatches(originalContent: string, blocks: PatchBlock[]): PatchResult {
  let content = originalContent
  let appliedCount = 0
  let failedCount = 0
  const failures: string[] = []

  for (const block of blocks) {
    // Try exact match first
    const idx = content.indexOf(block.search)
    if (idx !== -1) {
      content = content.slice(0, idx) + block.replace + content.slice(idx + block.search.length)
      appliedCount++
      continue
    }

    // Fallback: whitespace-normalized match (line-based approach)
    // normalizeForMatch preserves line count (only trims trailing whitespace + tabs→spaces)
    // so we can safely map normalized line positions back to original lines
    const normalizedContent = normalizeForMatch(content)
    const normalizedSearch = normalizeForMatch(block.search)
    const normalizedIdx = normalizedContent.indexOf(normalizedSearch)

    if (normalizedIdx !== -1) {
      // Count newlines before the match to find the starting line
      const beforeMatch = normalizedContent.slice(0, normalizedIdx)
      const startLine = beforeMatch.split('\n').length - 1
      const searchLineCount = normalizedSearch.split('\n').length

      // Replace the matching lines in the original content
      const originalLines = content.split('\n')
      const before = originalLines.slice(0, startLine)
      const after = originalLines.slice(startLine + searchLineCount)

      content = [...before, block.replace, ...after].join('\n')
      appliedCount++
      continue
    }

    // Match failed
    failedCount++
    const preview = block.search.length > 80 ? block.search.slice(0, 80) + '...' : block.search
    failures.push(preview)
  }

  return {
    success: appliedCount > 0,
    content,
    appliedCount,
    failedCount,
    failures,
  }
}
