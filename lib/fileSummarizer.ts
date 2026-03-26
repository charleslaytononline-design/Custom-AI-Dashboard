/**
 * Generates concise summaries of TypeScript/React files for AI context.
 * Uses regex-based extraction (no TS compiler needed).
 * Produces 1-line summaries: "exports ComponentName (props: {x, y}), uses useEffect, supabase"
 */

interface FileSummary {
  path: string
  summary: string
}

/**
 * Extract a concise summary from a TypeScript/React file.
 */
function summarizeFile(path: string, content: string): string {
  const parts: string[] = []

  // Detect file type from path
  const isPage = path.includes('/pages/')
  const isComponent = path.includes('/components/')
  const isHook = path.includes('/hooks/')
  const isType = path.includes('/types/')
  const isUtil = path.includes('/lib/') || path.includes('/utils/')
  const isContext = path.includes('/contexts/') || path.includes('/context/')

  // Extract default export name
  const defaultExport = content.match(/export\s+default\s+function\s+(\w+)/)
  if (defaultExport) {
    const kind = isPage ? 'page' : isComponent ? 'component' : isContext ? 'context' : 'module'
    parts.push(`${kind} ${defaultExport[1]}`)
  }

  // Extract named exports
  const namedExports = content.match(/export\s+(?:function|const|interface|type|class)\s+(\w+)/g)
  if (namedExports) {
    const names = namedExports
      .map(m => m.replace(/export\s+(?:function|const|interface|type|class)\s+/, ''))
      .filter(n => n !== defaultExport?.[1])
      .slice(0, 4)
    if (names.length > 0) {
      parts.push(`exports: ${names.join(', ')}`)
    }
  }

  // Extract props interface for components
  const propsMatch = content.match(/interface\s+\w*Props\s*\{([^}]*)\}/)
  if (propsMatch) {
    const propNames = propsMatch[1]
      .split('\n')
      .map(line => line.trim().match(/^(\w+)/))
      .filter(Boolean)
      .map(m => m![1])
      .slice(0, 5)
    if (propNames.length > 0) {
      parts.push(`props: {${propNames.join(', ')}}`)
    }
  }

  // Detect hooks usage
  if (isHook) {
    const hookReturn = content.match(/return\s*\{([^}]*)\}/)
    if (hookReturn) {
      const returnVars = hookReturn[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean).slice(0, 5)
      parts.push(`returns: {${returnVars.join(', ')}}`)
    }
  }

  // Detect key imports/dependencies
  const keyDeps: string[] = []
  if (content.includes('supabase')) keyDeps.push('supabase')
  if (content.includes('useAuth')) keyDeps.push('auth')
  if (content.includes('useNavigate') || content.includes('useRouter')) keyDeps.push('router')
  if (content.includes('useState')) keyDeps.push('state')
  if (content.includes('useEffect')) keyDeps.push('effects')
  if (content.includes('fetch(') || content.includes('axios')) keyDeps.push('fetch')
  if (keyDeps.length > 0) parts.push(`uses: ${keyDeps.join(', ')}`)

  // Type files: list interfaces/types
  if (isType) {
    const typeNames = content.match(/(?:interface|type)\s+(\w+)/g)
    if (typeNames) {
      const names = typeNames.map(t => t.replace(/(?:interface|type)\s+/, '')).slice(0, 6)
      parts.push(`types: ${names.join(', ')}`)
    }
  }

  // Util files: list function names
  if (isUtil && !defaultExport) {
    const funcNames = content.match(/export\s+(?:function|const)\s+(\w+)/g)
    if (funcNames) {
      const names = funcNames.map(f => f.replace(/export\s+(?:function|const)\s+/, '')).slice(0, 5)
      parts.push(`utilities: ${names.join(', ')}`)
    }
  }

  return parts.join(' | ') || 'empty file'
}

/**
 * Generate summaries for all files not included in full context.
 */
export function generateFileSummaries(
  allFiles: Array<{ path: string; content: string | null }>,
  excludePaths: Set<string>,
): FileSummary[] {
  const summaries: FileSummary[] = []

  for (const file of allFiles) {
    if (excludePaths.has(file.path)) continue
    if (!file.content) continue
    // Skip non-code files
    if (!file.path.match(/\.(tsx?|jsx?)$/)) continue
    // Skip config files
    if (['package.json', 'vite.config.ts', 'tsconfig.json', 'tailwind.config.js', 'postcss.config.js'].includes(file.path)) continue

    summaries.push({
      path: file.path,
      summary: summarizeFile(file.path, file.content),
    })
  }

  return summaries
}
