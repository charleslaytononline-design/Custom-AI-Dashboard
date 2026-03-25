/**
 * Smart context management for React project builds.
 * Selects relevant files to include in AI context while staying within token budgets.
 */

import type { ProjectFile } from './virtualFS'

interface FileContext {
  path: string
  content: string
  role: 'active' | 'referenced' | 'imported' | 'core'
}

/** Files that are always included with full content */
const CORE_FILES = ['src/App.tsx', 'src/lib/supabase.ts']

/** Files to never send to the AI (template boilerplate) */
const EXCLUDED_FILES = [
  'package.json', 'vite.config.ts', 'tsconfig.json',
  'tailwind.config.js', 'postcss.config.js', '.env', '.gitignore',
]

/**
 * Parse import paths from a TypeScript/React file.
 * Returns relative paths like './components/Layout' -> 'src/components/Layout'
 */
function parseImports(content: string, filePath: string): string[] {
  const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g
  const imports: string[] = []
  let match: RegExpExecArray | null

  const dirParts = filePath.split('/')
  dirParts.pop() // remove filename
  const dir = dirParts.join('/')

  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1]
    // Only resolve relative imports (skip node_modules)
    if (!importPath.startsWith('.')) continue

    // Resolve relative path
    const parts = [...dir.split('/'), ...importPath.split('/')]
    const resolved: string[] = []
    for (const part of parts) {
      if (part === '..') resolved.pop()
      else if (part !== '.') resolved.push(part)
    }
    let resolvedPath = resolved.join('/')

    // Try common extensions
    imports.push(resolvedPath)
    if (!resolvedPath.match(/\.(tsx?|jsx?|css|json)$/)) {
      imports.push(resolvedPath + '.tsx')
      imports.push(resolvedPath + '.ts')
      imports.push(resolvedPath + '/index.tsx')
      imports.push(resolvedPath + '/index.ts')
    }
  }

  return imports
}

/**
 * Build context for the AI from project files.
 * Returns a structured context string and the list of files included.
 */
export function buildReactContext(
  allFiles: ProjectFile[],
  activeFilePath: string | null,
  userPrompt: string,
): { fileTree: string; contextFiles: FileContext[]; routeMap: string } {
  const fileMap = new Map<string, ProjectFile>()
  for (const f of allFiles) {
    fileMap.set(f.path, f)
  }

  const contextFiles: FileContext[] = []
  const includedPaths = new Set<string>()

  // 1. Always include core files
  for (const corePath of CORE_FILES) {
    const file = fileMap.get(corePath)
    if (file?.content) {
      contextFiles.push({ path: corePath, content: file.content, role: 'core' })
      includedPaths.add(corePath)
    }
  }

  // 2. Include active file
  if (activeFilePath) {
    const activeFile = fileMap.get(activeFilePath)
    if (activeFile?.content && !includedPaths.has(activeFilePath)) {
      contextFiles.push({ path: activeFilePath, content: activeFile.content, role: 'active' })
      includedPaths.add(activeFilePath)

      // 3. Parse imports from active file and include them
      const importPaths = parseImports(activeFile.content, activeFilePath)
      for (const importPath of importPaths) {
        if (includedPaths.has(importPath)) continue
        const importFile = fileMap.get(importPath)
        if (importFile?.content) {
          contextFiles.push({ path: importPath, content: importFile.content, role: 'imported' })
          includedPaths.add(importPath)
        }
      }
    }
  }

  // 4. Scan user prompt for file/component mentions
  const promptLower = userPrompt.toLowerCase()
  for (const file of allFiles) {
    if (includedPaths.has(file.path) || EXCLUDED_FILES.includes(file.path)) continue
    if (!file.content) continue

    // Check if filename or component name is mentioned
    const fileName = file.path.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '') || ''
    if (fileName && promptLower.includes(fileName.toLowerCase())) {
      contextFiles.push({ path: file.path, content: file.content, role: 'referenced' })
      includedPaths.add(file.path)
    }
  }

  // 5. Build file tree (paths only, for all files)
  const fileTree = allFiles
    .filter(f => !EXCLUDED_FILES.includes(f.path))
    .map(f => `  ${f.path}`)
    .join('\n')

  // 6. Extract route map from App.tsx
  let routeMap = ''
  const appFile = fileMap.get('src/App.tsx')
  if (appFile?.content) {
    const routeRegex = /<Route\s+[^>]*path=["']([^"']+)["'][^>]*element=\{<(\w+)/g
    let routeMatch: RegExpExecArray | null
    const routes: string[] = []
    while ((routeMatch = routeRegex.exec(appFile.content)) !== null) {
      routes.push(`  ${routeMatch[1]} -> ${routeMatch[2]}`)
    }
    if (routes.length > 0) {
      routeMap = routes.join('\n')
    }
  }

  return { fileTree, contextFiles, routeMap }
}

/**
 * Compact chat history for React projects.
 * Same logic as the HTML version but preserves file operation context.
 */
export function compactReactHistory(
  messages: Array<{ role: string; content: string }>,
  keepLast: number = 4,
): { summary: string | null; recentMessages: Array<{ role: string; content: string }> } {
  if (messages.length <= keepLast + 2) {
    return { summary: null, recentMessages: messages }
  }

  const olderMessages = messages.slice(0, -keepLast)
  const recentMessages = messages.slice(-keepLast)

  const summaryParts: string[] = []
  for (const msg of olderMessages) {
    const content = typeof msg.content === 'string' ? msg.content : '[media]'
    // For assistant messages, extract FILE_OP summaries
    if (msg.role === 'assistant') {
      const ops: string[] = []
      const opRegex = /<FILE_OP\s+action="(\w+)"\s+path="([^"]+)"/g
      let opMatch: RegExpExecArray | null
      while ((opMatch = opRegex.exec(content)) !== null) {
        ops.push(`${opMatch[1]}:${opMatch[2]}`)
      }
      if (ops.length > 0) {
        summaryParts.push(`assistant: [file ops: ${ops.join(', ')}]`)
        continue
      }
    }
    const truncated = content.slice(0, 150).replace(/\s+/g, ' ')
    summaryParts.push(`${msg.role}: ${truncated}`)
  }

  const summary = `Previous conversation (${olderMessages.length} messages):\n${summaryParts.join('\n')}`
  return { summary, recentMessages }
}
