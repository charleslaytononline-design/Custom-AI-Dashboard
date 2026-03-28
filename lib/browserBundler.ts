/**
 * In-browser bundler using esbuild-wasm.
 * Bundles React project files stored in the database into a single JS bundle
 * that can be rendered in an iframe preview.
 */
import * as esbuild from 'esbuild-wasm'

let initialized = false
let initPromise: Promise<void> | null = null

/** Known npm packages → esm.sh CDN URLs */
const CDN_PACKAGES: Record<string, string> = {
  'react': 'https://esm.sh/react@18.3.1',
  'react/jsx-runtime': 'https://esm.sh/react@18.3.1/jsx-runtime',
  'react/jsx-dev-runtime': 'https://esm.sh/react@18.3.1/jsx-dev-runtime',
  'react-dom': 'https://esm.sh/react-dom@18.3.1',
  'react-dom/client': 'https://esm.sh/react-dom@18.3.1/client',
  'react-router-dom': 'https://esm.sh/react-router-dom@6.28.0?external=react,react-dom',
  '@supabase/supabase-js': 'https://esm.sh/@supabase/supabase-js@2.47.0',
  'lucide-react': 'https://esm.sh/lucide-react@0.460.0?external=react',
  // Three.js ecosystem
  'three': 'https://esm.sh/three@0.170.0',
  'three/addons': 'https://esm.sh/three@0.170.0/addons',
  'three/examples/jsm/controls/OrbitControls': 'https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls',
  'three/examples/jsm/loaders/GLTFLoader': 'https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader',
  '@react-three/fiber': 'https://esm.sh/@react-three/fiber@8.17.10?external=react,react-dom,three',
  '@react-three/drei': 'https://esm.sh/@react-three/drei@9.117.3?external=react,react-dom,three,@react-three/fiber',
  // Animation libraries
  'framer-motion': 'https://esm.sh/framer-motion@11.15.0?external=react,react-dom',
  // Chart libraries
  'recharts': 'https://esm.sh/recharts@2.15.0?external=react,react-dom',
  // Date utilities
  'date-fns': 'https://esm.sh/date-fns@4.1.0',
}

export interface BundleInput {
  /** All project files keyed by path (e.g. "src/App.tsx" → content) */
  files: Record<string, string>
  /** Optional extra npm packages (name → version) resolved from esm.sh */
  extraPackages?: Record<string, string>
  /** Environment variables injected as import.meta.env.* */
  envVars?: Record<string, string>
}

export interface BundleResult {
  /** Bundled JavaScript as a string */
  js: string
  /** Bundled CSS as a string */
  css: string
  /** CDN URL map for import map (bare specifier → CDN URL) */
  cdnMap: Record<string, string>
  /** Any warnings from esbuild */
  warnings: string[]
  /** Any errors from esbuild */
  errors: string[]
  /** Files actually loaded by the bundler (reachable from entry point) */
  loadedFiles: string[]
  /** Whether App.tsx was auto-patched to import unreachable components */
  autoPatched?: boolean
}

/**
 * Initialize esbuild-wasm. Call once on first bundle.
 */
async function ensureInitialized() {
  if (initialized) return
  if (initPromise) { await initPromise; return }

  initPromise = esbuild.initialize({
    wasmURL: 'https://unpkg.com/esbuild-wasm@0.27.4/esbuild.wasm',
  })

  await initPromise
  initialized = true
}

/**
 * Resolve import paths, handling extension inference and index files.
 * E.g. "./components/Layout" → "src/components/Layout.tsx"
 */
function resolveFilePath(importer: string, importPath: string, files: Record<string, string>): string | null {
  // Get the directory of the importing file
  const importerDir = importer.includes('/') ? importer.substring(0, importer.lastIndexOf('/')) : ''

  let resolved: string

  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    // Relative import
    const parts = [...importerDir.split('/'), ...importPath.split('/')]
    const normalized: string[] = []
    for (const part of parts) {
      if (part === '.' || part === '') continue
      if (part === '..') { normalized.pop(); continue }
      normalized.push(part)
    }
    resolved = normalized.join('/')
  } else if (importPath.startsWith('@/')) {
    // Alias: @/ → src/
    resolved = 'src/' + importPath.slice(2)
  } else {
    // Bare specifier — could be an npm package, or a project file without ./
    // Try prepending src/ (e.g. "components/Foo" → "src/components/Foo")
    resolved = 'src/' + importPath
    // Fall through to extension resolution below
  }

  // Try exact match first
  if (files[resolved]) return resolved

  // Try with extensions
  const extensions = ['.tsx', '.ts', '.jsx', '.js', '.json', '.css']
  for (const ext of extensions) {
    if (files[resolved + ext]) return resolved + ext
  }

  // Try as directory with index file
  for (const ext of extensions) {
    if (files[resolved + '/index' + ext]) return resolved + '/index' + ext
  }

  return null
}

/**
 * Determine the esbuild loader for a file path
 */
function getLoader(filePath: string): esbuild.Loader {
  const ext = filePath.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'tsx': return 'tsx'
    case 'ts': return 'ts'
    case 'jsx': return 'jsx'
    case 'js': return 'js'
    case 'css': return 'css'
    case 'json': return 'json'
    case 'svg': return 'text'
    default: return 'text'
  }
}

/**
 * Build the CDN URL map including user-added packages
 */
function buildCdnMap(extraPackages?: Record<string, string>): Record<string, string> {
  const map = { ...CDN_PACKAGES }
  if (extraPackages) {
    const pkgNames = Object.keys(extraPackages)
    for (let i = 0; i < pkgNames.length; i++) {
      const name = pkgNames[i]
      const version = extraPackages[name]
      if (!map[name]) {
        const hasReactPeer = ['lucide-react', 'react-router-dom', 'react-icons', 'framer-motion', '@headlessui/react', '@radix-ui/react-dialog'].some(p => name.startsWith(p.split('/')[0]))
        map[name] = `https://esm.sh/${name}@${version}${hasReactPeer ? '?external=react,react-dom' : ''}`
      }
    }
  }
  return map
}

/**
 * Check if App.tsx is a stub (placeholder with no real component imports).
 */
function isStubAppTsx(content: string): boolean {
  if (content.length > 400) return false
  // Check if it imports any project files (relative, alias, or src/ imports)
  const hasProjectImports = /import\s+.*from\s+['"](\.\/?components|\.\/hooks|\.\/lib|\.\/pages|\.\/views|@\/|src\/)/.test(content)
  return !hasProjectImports
}

/** Check if a file exports a default component (broadened to catch forwardRef, memo, etc.) */
function hasDefaultExport(content: string): boolean {
  return /export\s+default\b/.test(content) ||
    /export\s*\{[^}]*\bdefault\b/.test(content) ||
    (/\bforwardRef\b/.test(content) && /export\s+default\b/.test(content))
}

/** Root-likelihood name bonus for common root component names */
function rootNameScore(filePath: string): number {
  const name = (filePath.split('/').pop() || '').replace(/\.(tsx|jsx)$/, '').toLowerCase()
  const highPriority = ['app', 'game', 'main', 'root', 'layout', 'canvas', 'world', 'scene']
  const medPriority = ['dashboard', 'home', 'page', 'screen', 'view', 'container', 'shell']
  if (highPriority.some(n => name.includes(n))) return 5
  if (medPriority.some(n => name.includes(n))) return 3
  return 0
}

/**
 * Find the root component among unreachable files by scoring:
 *   score = importCount * 3 + nameBonus + sizeBonus
 */
function findRootComponent(
  unreachableFiles: string[],
  files: Record<string, string>
): string | null {
  // Only consider .tsx/.jsx files that export a default (likely React components)
  const componentFiles = unreachableFiles.filter(f => {
    if (!f.match(/\.(tsx|jsx)$/)) return false
    const content = files[f]
    if (!content) return false
    return hasDefaultExport(content)
  })

  if (componentFiles.length === 0) return null
  if (componentFiles.length === 1) return componentFiles[0]

  // Score each component
  const scored: Array<{ file: string; score: number }> = []

  for (const file of componentFiles) {
    const content = files[file]
    if (!content) continue

    // Count imports that reference other unreachable files
    const importRegex = /import\s+.*?from\s+['"](.*?)['"]/g
    let importCount = 0
    let match
    while ((match = importRegex.exec(content)) !== null) {
      const resolved = resolveFilePath(file, match[1], files)
      if (resolved && unreachableFiles.includes(resolved)) {
        importCount++
      }
    }

    const nameBonus = rootNameScore(file)
    const sizeBonus = content.length > 5000 ? 2 : content.length > 2000 ? 1 : 0
    const score = importCount * 3 + nameBonus + sizeBonus

    scored.push({ file, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.file || componentFiles[0]
}

/**
 * Generate a patched App.tsx that imports and renders components with error boundary.
 * Renders the root component first, then all other orphan components.
 */
function generatePatchedAppTsx(
  rootFile: string,
  allComponentFiles: string[],
  unreachableHooks: string[],
  files: Record<string, string>
): string {
  const toRelative = (filePath: string) => {
    const withoutSrc = filePath.replace(/^src\//, '')
    const withoutExt = withoutSrc.replace(/\.(tsx|ts|jsx|js)$/, '')
    return './' + withoutExt
  }

  const toComponentName = (filePath: string) =>
    filePath.split('/').pop()?.replace(/\.(tsx|jsx)$/, '') || 'Comp'

  // Build component imports — root first, then all others
  const imports: string[] = []
  const elements: string[] = []
  const usedNames = new Set<string>()

  const addComponent = (file: string) => {
    let name = toComponentName(file)
    if (usedNames.has(name)) name = name + usedNames.size
    usedNames.add(name)
    imports.push(`import ${name} from '${toRelative(file)}'`)
    elements.push(`<${name} />`)
  }

  if (rootFile) {
    addComponent(rootFile)
    // Add other components not imported by the root
    for (const file of allComponentFiles) {
      if (file !== rootFile) addComponent(file)
    }
  } else {
    for (const file of allComponentFiles) {
      addComponent(file)
    }
  }

  // Detect hooks that return state (e.g., usePlayerData)
  const hookCalls: string[] = []
  for (const hookFile of unreachableHooks) {
    const content = files[hookFile]
    if (!content) continue
    const hookMatch = content.match(/export\s+(?:function|const)\s+(use\w+)/)
    if (hookMatch) {
      const hookName = hookMatch[1]
      imports.push(`import { ${hookName} } from '${toRelative(hookFile)}'`)
      hookCalls.push(`  const _${hookName} = ${hookName}()`)
    }
  }

  // Error boundary to catch render crashes
  const errorBoundary = `class EB extends Component<{children:any},{error:string|null}>{state={error:null as string|null};static getDerivedStateFromError(e:any){return{error:e?.message||String(e)}};render(){if(this.state.error)return <div style={{padding:24,color:'#ff6b6b',background:'#1a1a2e',fontFamily:'monospace',minHeight:'100vh'}}><h2 style={{margin:'0 0 12px'}}>Render Error</h2><pre style={{whiteSpace:'pre-wrap',opacity:0.8}}>{this.state.error}</pre><p style={{color:'#888',marginTop:16}}>The AI may not have properly connected all components. Try asking it to fix App.tsx.</p></div>;return this.props.children}}`

  const lines = [
    `import { Component } from 'react'`,
    ...imports,
    '',
    errorBoundary,
    '',
    `export default function App() {`,
    ...hookCalls,
    `  return (`,
    `    <EB>`,
    `      ${elements.join('\n      ')}`,
    `    </EB>`,
    `  )`,
    `}`,
    '',
  ]

  return lines.join('\n')
}

/**
 * Bundle project files into a single JS + CSS output.
 */
export async function bundleProject(input: BundleInput): Promise<BundleResult> {
  await ensureInitialized()

  const { files, extraPackages, envVars = {} } = input
  const cdnMap = buildCdnMap(extraPackages)

  // Build define map for import.meta.env.*
  // Individual keys get replaced at build time (most specific match).
  // The catch-all import.meta.env object prevents TypeError when code
  // accesses env vars that aren't in the define map (e.g. VITE_SUPABASE_URL
  // when Supabase isn't connected yet).
  const envObject: Record<string, any> = {
    DEV: true, PROD: false, MODE: 'development',
    ...envVars,
  }
  const define: Record<string, string> = {
    'import.meta.env': JSON.stringify(envObject),
    'import.meta.env.DEV': 'true',
    'import.meta.env.PROD': 'false',
    'import.meta.env.MODE': '"development"',
  }
  const envKeys = Object.keys(envVars)
  for (let i = 0; i < envKeys.length; i++) {
    define[`import.meta.env.${envKeys[i]}`] = JSON.stringify(envVars[envKeys[i]])
  }

  // Collect CSS imports to concatenate separately
  let collectedCss = ''
  // Track which files are actually loaded by the bundler
  const loadedFiles: string[] = []

  try {
    const result = await esbuild.build({
      entryPoints: ['src/main.tsx'],
      bundle: true,
      format: 'esm',
      jsx: 'automatic',
      jsxImportSource: 'react',
      define,
      write: false,
      // Virtual filesystem plugin
      plugins: [
        {
          name: 'virtual-fs',
          setup(build) {
            // IMPORTANT: Entry point resolver MUST come first.
            // The entry point "src/main.tsx" starts with "s", not "." or "/",
            // so the bare-module resolver would catch it and mark it external.
            build.onResolve({ filter: /^src\/main\.tsx$/ }, () => {
              return { path: 'src/main.tsx', namespace: 'virtual' }
            })

            // Resolve relative & alias imports to virtual files
            // Also catches paths like "src/..." that exist in the file map
            build.onResolve({ filter: /^(\.\/|\.\.\/|@\/|src\/)/ }, (args) => {
              // Direct match in files map (e.g. "src/lib/supabase.ts")
              if (files[args.path]) {
                return { path: args.path, namespace: 'virtual' }
              }
              const resolved = resolveFilePath(args.importer, args.path, files)
              if (resolved) {
                return { path: resolved, namespace: 'virtual' }
              }
              return { errors: [{ text: `Could not resolve "${args.path}" from "${args.importer}"` }] }
            })

            // Resolve bare module imports — keep bare specifiers (import map resolves them)
            // This MUST come after the virtual file resolvers so project files aren't treated as packages
            build.onResolve({ filter: /^[^./]/ }, (args) => {
              // Safety check: if this path exists in our virtual files, resolve it there
              if (files[args.path]) {
                return { path: args.path, namespace: 'virtual' }
              }
              const resolvedVirtual = resolveFilePath(args.importer, args.path, files)
              if (resolvedVirtual) {
                return { path: resolvedVirtual, namespace: 'virtual' }
              }

              // Keep bare specifier as-is — the import map in the preview HTML will resolve it
              // Ensure the cdnMap has an entry for this exact specifier
              if (!cdnMap[args.path]) {
                const pkgName = args.path.startsWith('@')
                  ? args.path.split('/').slice(0, 2).join('/')
                  : args.path.split('/')[0]
                const baseCdn = cdnMap[pkgName]
                if (baseCdn) {
                  // Known package, sub-path import — construct CDN URL
                  const subPath = args.path.slice(pkgName.length)
                  const baseUrl = baseCdn.split('?')[0]
                  const params = baseCdn.includes('?') ? '?' + baseCdn.split('?')[1] : ''
                  cdnMap[args.path] = `${baseUrl}${subPath}${params}`
                } else {
                  // Unknown package — add esm.sh fallback
                  cdnMap[args.path] = `https://esm.sh/${args.path}`
                }
              }
              return { path: args.path, external: true }
            })

            // Load virtual files from the in-memory file map
            build.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => {
              let content = files[args.path]
              if (content === undefined) {
                return { errors: [{ text: `File not found: ${args.path}` }] }
              }
              loadedFiles.push(args.path)
              const loader = getLoader(args.path)
              // Collect CSS separately
              if (loader === 'css') {
                // Strip @tailwind directives (handled by CDN play script)
                // Strip @apply directives (CDN can't process custom utilities)
                const cleanedCss = content
                  .replace(/@tailwind\s+(base|components|utilities);?\s*/g, '')
                  .replace(/@apply\s+[^;]+;?\s*/g, '')
                  .trim()
                if (cleanedCss) collectedCss += '\n' + cleanedCss
                return { contents: '', loader: 'js' }
              }
              // Swap BrowserRouter → MemoryRouter for preview (srcdoc iframes
              // have pathname "srcdoc" instead of "/", breaking BrowserRouter)
              // Also inject future flags to silence React Router v7 deprecation warnings
              if ((loader === 'tsx' || loader === 'ts' || loader === 'jsx' || loader === 'js') && content.includes('BrowserRouter')) {
                content = content
                  .replace(/\bBrowserRouter\b/g, 'MemoryRouter')
                  .replace(/<MemoryRouter>/g, '<MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}>')
              }
              return { contents: content, loader }
            })
          },
        },
      ],
    })

    // Find the JS output — try .js extension first, then fall back to first output file
    // (esbuild-wasm may use paths like "<stdout>" when outdir/outfile aren't set)
    const outputPaths = (result.outputFiles || []).map(f => `${f.path} (${f.text.length} chars)`)
    if (typeof console !== 'undefined') {
      console.log('[Bundler] outputFiles:', outputPaths.join(', ') || 'none')
    }
    const jsFile = result.outputFiles?.find(f => f.path.endsWith('.js'))
      || result.outputFiles?.[0]
    const js = jsFile?.text || ''
    const css = collectedCss
    const warnings = result.warnings.map(w => `${w.text} (${w.location?.file}:${w.location?.line})`)
    const errors = result.errors.map(e => `${e.text} (${e.location?.file}:${e.location?.line})`)

    // Auto-patch: if App.tsx is a stub and most files are unreachable, inject imports and re-bundle
    const sourceFiles = Object.keys(files).filter(f => f.match(/^src\/.*\.(tsx|ts|jsx|js)$/))
    const unreachableSource = sourceFiles.filter(f => !loadedFiles.includes(f))
    const appContent = files['src/App.tsx'] || ''

    if (
      result.errors.length === 0 &&
      files['src/App.tsx'] &&
      unreachableSource.length > 0 &&
      (isStubAppTsx(appContent) || unreachableSource.length > sourceFiles.length * 0.2)
    ) {
      console.log(`[Bundler] ${unreachableSource.length}/${sourceFiles.length} source files unreachable (App.tsx stub: ${isStubAppTsx(appContent)}) — auto-patching...`)

      const rootComponent = findRootComponent(unreachableSource, files)
      const componentFiles = unreachableSource.filter(f =>
        f.match(/\.(tsx|jsx)$/) && files[f] && hasDefaultExport(files[f])
      )
      const unreachableHooks = unreachableSource.filter(f =>
        f.match(/^src\/hooks\/.*\.(ts|tsx)$/) && files[f]
      )

      if (rootComponent || componentFiles.length > 0) {
        const patchedApp = generatePatchedAppTsx(rootComponent || '', componentFiles, unreachableHooks, files)
        console.log(`[Bundler] Auto-patched App.tsx — root: ${rootComponent || 'all components'}\n${patchedApp}`)

        // Re-bundle with patched App.tsx
        const patchedFiles: Record<string, string> = { ...files, 'src/App.tsx': patchedApp }
        let patchedCss = ''
        const patchedLoadedFiles: string[] = []

        const patchedResult = await esbuild.build({
          entryPoints: ['src/main.tsx'],
          bundle: true,
          format: 'esm',
          jsx: 'automatic',
          jsxImportSource: 'react',
          define,
          write: false,
          plugins: [
            {
              name: 'virtual-fs-patched',
              setup(build) {
                build.onResolve({ filter: /^src\/main\.tsx$/ }, () => {
                  return { path: 'src/main.tsx', namespace: 'virtual' }
                })
                build.onResolve({ filter: /^(\.\/|\.\.\/|@\/|src\/)/ }, (args) => {
                  if (patchedFiles[args.path]) {
                    return { path: args.path, namespace: 'virtual' }
                  }
                  const resolved = resolveFilePath(args.importer, args.path, patchedFiles)
                  if (resolved) {
                    return { path: resolved, namespace: 'virtual' }
                  }
                  return { errors: [{ text: `Could not resolve "${args.path}" from "${args.importer}"` }] }
                })
                build.onResolve({ filter: /^[^./]/ }, (args) => {
                  if (patchedFiles[args.path]) {
                    return { path: args.path, namespace: 'virtual' }
                  }
                  const resolvedVirtual = resolveFilePath(args.importer, args.path, patchedFiles)
                  if (resolvedVirtual) {
                    return { path: resolvedVirtual, namespace: 'virtual' }
                  }
                  if (!cdnMap[args.path]) {
                    const pkgName = args.path.startsWith('@')
                      ? args.path.split('/').slice(0, 2).join('/')
                      : args.path.split('/')[0]
                    const baseCdn = cdnMap[pkgName]
                    if (baseCdn) {
                      const subPath = args.path.slice(pkgName.length)
                      const baseUrl = baseCdn.split('?')[0]
                      const params = baseCdn.includes('?') ? '?' + baseCdn.split('?')[1] : ''
                      cdnMap[args.path] = `${baseUrl}${subPath}${params}`
                    } else {
                      cdnMap[args.path] = `https://esm.sh/${args.path}`
                    }
                  }
                  return { path: args.path, external: true }
                })
                build.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => {
                  let content = patchedFiles[args.path]
                  if (content === undefined) {
                    return { errors: [{ text: `File not found: ${args.path}` }] }
                  }
                  patchedLoadedFiles.push(args.path)
                  const loader = getLoader(args.path)
                  if (loader === 'css') {
                    const cleanedCss = content
                      .replace(/@tailwind\s+(base|components|utilities);?\s*/g, '')
                      .replace(/@apply\s+[^;]+;?\s*/g, '')
                      .trim()
                    if (cleanedCss) patchedCss += '\n' + cleanedCss
                    return { contents: '', loader: 'js' }
                  }
                  if ((loader === 'tsx' || loader === 'ts' || loader === 'jsx' || loader === 'js') && content.includes('BrowserRouter')) {
                    content = content
                      .replace(/\bBrowserRouter\b/g, 'MemoryRouter')
                      .replace(/<MemoryRouter>/g, '<MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}>')
                  }
                  return { contents: content, loader }
                })
              },
            },
          ],
        })

        const patchedJsFile = patchedResult.outputFiles?.find(f => f.path.endsWith('.js'))
          || patchedResult.outputFiles?.[0]
        const patchedJs = patchedJsFile?.text || ''
        const patchedWarnings = patchedResult.warnings.map(w => `${w.text} (${w.location?.file}:${w.location?.line})`)
        const patchedErrors = patchedResult.errors.map(e => `${e.text} (${e.location?.file}:${e.location?.line})`)

        console.log(`[Bundler] Re-bundle after auto-patch — js: ${patchedJs.length} chars, loaded: ${patchedLoadedFiles.length} files`)

        // Only use patched result if it's actually better
        if (patchedJs.length > js.length && patchedErrors.length === 0) {
          return { js: patchedJs, css: patchedCss, cdnMap, warnings: patchedWarnings, errors: patchedErrors, loadedFiles: patchedLoadedFiles, autoPatched: true }
        }
      }
    }

    return { js, css, cdnMap, warnings, errors, loadedFiles }
  } catch (err: any) {
    // esbuild throws on fatal errors
    const errorMsg = err.message || String(err)
    // Parse esbuild error messages into readable format
    const errors = err.errors
      ? err.errors.map((e: any) => `${e.text}${e.location ? ` (${e.location.file}:${e.location.line})` : ''}`)
      : [errorMsg]

    return { js: '', css: '', cdnMap, warnings: [], errors, loadedFiles }
  }
}
