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

    // Fallback: whitespace-normalized match
    const normalizedContent = normalizeForMatch(content)
    const normalizedSearch = normalizeForMatch(block.search)
    const normalizedIdx = normalizedContent.indexOf(normalizedSearch)

    if (normalizedIdx !== -1) {
      // Find the corresponding position in the original content
      // Map normalized position back to original by counting characters line-by-line
      const normalizedBefore = normalizedContent.slice(0, normalizedIdx)
      const normalizedMatch = normalizedContent.slice(normalizedIdx, normalizedIdx + normalizedSearch.length)

      // Count newlines to find the line range
      const startLine = normalizedBefore.split('\n').length - 1
      const matchLines = normalizedMatch.split('\n').length

      // Reconstruct the original text range using line positions
      const originalLines = content.split('\n')
      const beforeLines = originalLines.slice(0, startLine).join('\n')
      const afterLines = originalLines.slice(startLine + matchLines).join('\n')

      content = beforeLines + (startLine > 0 ? '\n' : '') + block.replace + (afterLines ? '\n' + afterLines : '')
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
