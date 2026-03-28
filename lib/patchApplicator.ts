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

/**
 * Compute a minimal diff between old and new file content.
 * Used during auto-fix to extract just the changed lines when the AI
 * ignores the patch instruction and sends a full rewrite.
 *
 * Returns SEARCH/REPLACE blocks for changed regions with context lines,
 * plus a changeRatio (0-1) indicating what fraction of lines changed.
 * Returns null if files are completely different or can't be diffed.
 */
export function computeMinimalDiff(
  oldContent: string,
  newContent: string,
  contextLines: number = 2,
): { blocks: PatchBlock[]; changeRatio: number } | null {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')

  // If lengths are wildly different, it's a full rewrite
  if (newLines.length === 0 || oldLines.length === 0) return null
  if (Math.abs(oldLines.length - newLines.length) > oldLines.length * 0.5) {
    return { blocks: [], changeRatio: 1 }
  }

  // Simple LCS-based line diff using a DP approach on normalized lines
  // For performance, limit to files under 2000 lines
  if (oldLines.length > 2000 || newLines.length > 2000) return null

  const oldNorm = oldLines.map(l => l.trimEnd())
  const newNorm = newLines.map(l => l.trimEnd())

  // Build LCS table
  const m = oldNorm.length
  const n = newNorm.length
  // Use space-efficient approach: only need two rows
  let prev = new Uint16Array(n + 1)
  let curr = new Uint16Array(n + 1)

  for (let i = 1; i <= m; i++) {
    [prev, curr] = [curr, prev]
    curr.fill(0)
    for (let j = 1; j <= n; j++) {
      if (oldNorm[i - 1] === newNorm[j - 1]) {
        curr[j] = prev[j - 1] + 1
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1])
      }
    }
  }

  // Backtrack to find the actual LCS (need full table for this)
  // Rebuild with full table for backtracking
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldNorm[i - 1] === newNorm[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to find which old lines are matched
  const oldMatched = new Set<number>()
  const newMatched = new Set<number>()
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (oldNorm[i - 1] === newNorm[j - 1]) {
      oldMatched.add(i - 1)
      newMatched.add(j - 1)
      i--; j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  // Find changed regions in old file
  const changedOldLines = oldLines.length - oldMatched.size
  const changedNewLines = newLines.length - newMatched.size
  const changeRatio = Math.max(changedOldLines, changedNewLines) / Math.max(oldLines.length, newLines.length)

  if (changeRatio === 0) return { blocks: [], changeRatio: 0 }
  if (changeRatio > 0.5) return { blocks: [], changeRatio }

  // Build changed regions by walking both sequences together
  // Map old line indices to new line indices via LCS matching
  const oldToNew = new Map<number, number>()
  i = m; j = n
  while (i > 0 && j > 0) {
    if (oldNorm[i - 1] === newNorm[j - 1]) {
      oldToNew.set(i - 1, j - 1)
      i--; j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  // Find contiguous groups of unmatched old lines → build SEARCH/REPLACE blocks
  const blocks: PatchBlock[] = []
  let regionStart = -1

  for (let idx = 0; idx <= oldLines.length; idx++) {
    const isMatched = oldMatched.has(idx)
    if (!isMatched && idx < oldLines.length) {
      if (regionStart === -1) regionStart = idx
    } else if (regionStart !== -1) {
      // End of a changed region: [regionStart, idx)
      const searchStart = Math.max(0, regionStart - contextLines)
      const searchEnd = Math.min(oldLines.length, idx + contextLines)
      const searchText = oldLines.slice(searchStart, searchEnd).join('\n')

      // Find corresponding new lines
      // Get the new line index for the context boundary lines
      let newStart = -1
      let newEnd = -1

      // Find the new line corresponding to searchStart context
      for (let s = searchStart; s >= 0; s--) {
        if (oldToNew.has(s)) { newStart = oldToNew.get(s)!; break }
      }
      if (newStart === -1) newStart = 0
      else newStart = Math.max(0, newStart - (searchStart === 0 ? 0 : 0))

      // Find the new line corresponding to searchEnd context
      for (let s = searchEnd - 1; s < newLines.length + oldLines.length; s++) {
        if (s < oldLines.length && oldToNew.has(s)) { newEnd = oldToNew.get(s)! + 1; break }
        if (s >= oldLines.length) { newEnd = newLines.length; break }
      }
      if (newEnd === -1) newEnd = newLines.length

      // Build replacement: context before + new content + context after
      const replaceStart = Math.max(0, newStart - (regionStart - searchStart))
      const replaceEnd = Math.min(newLines.length, newEnd + (searchEnd - idx))
      const replaceText = newLines.slice(replaceStart, replaceEnd).join('\n')

      if (searchText !== replaceText) {
        blocks.push({ search: searchText, replace: replaceText })
      }

      regionStart = -1
    }
  }

  return { blocks, changeRatio }
}
