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
  /** Any warnings from esbuild */
  warnings: string[]
  /** Any errors from esbuild */
  errors: string[]
}

/**
 * Initialize esbuild-wasm. Call once on first bundle.
 */
async function ensureInitialized() {
  if (initialized) return
  if (initPromise) { await initPromise; return }

  initPromise = esbuild.initialize({
    wasmURL: 'https://unpkg.com/esbuild-wasm@latest/esbuild.wasm',
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
    // Bare module specifier (npm package)
    return null
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
    for (const [name, version] of Object.entries(extraPackages)) {
      if (!map[name]) {
        // External react to avoid duplicate copies
        const hasReactPeer = ['lucide-react', 'react-router-dom', 'react-icons', 'framer-motion', '@headlessui/react', '@radix-ui/react-dialog'].some(p => name.startsWith(p.split('/')[0]))
        map[name] = `https://esm.sh/${name}@${version}${hasReactPeer ? '?external=react,react-dom' : ''}`
      }
    }
  }
  return map
}

/**
 * Bundle project files into a single JS + CSS output.
 */
export async function bundleProject(input: BundleInput): Promise<BundleResult> {
  await ensureInitialized()

  const { files, extraPackages, envVars = {} } = input
  const cdnMap = buildCdnMap(extraPackages)

  // Build define map for import.meta.env.*
  const define: Record<string, string> = {
    'import.meta.env.DEV': 'true',
    'import.meta.env.PROD': 'false',
    'import.meta.env.MODE': '"development"',
  }
  for (const [key, value] of Object.entries(envVars)) {
    define[`import.meta.env.${key}`] = JSON.stringify(value)
  }

  // Collect CSS imports to concatenate separately
  let collectedCss = ''

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
            // Resolve bare module imports to CDN URLs
            build.onResolve({ filter: /^[^./]/ }, (args) => {
              // Check exact match first, then try the package name
              const cdnUrl = cdnMap[args.path]
              if (cdnUrl) {
                return { path: cdnUrl, external: true }
              }
              // Try just the package name (e.g. "lucide-react/icons/Home" → base package)
              const pkgName = args.path.startsWith('@')
                ? args.path.split('/').slice(0, 2).join('/')
                : args.path.split('/')[0]
              const baseCdn = cdnMap[pkgName]
              if (baseCdn) {
                // Construct sub-path CDN URL
                const subPath = args.path.slice(pkgName.length)
                const baseUrl = baseCdn.split('?')[0]
                const params = baseCdn.includes('?') ? '?' + baseCdn.split('?')[1] : ''
                return { path: `${baseUrl}${subPath}${params}`, external: true }
              }
              // Unknown package — try esm.sh as fallback
              return { path: `https://esm.sh/${args.path}`, external: true }
            })

            // Resolve relative & alias imports to virtual files
            build.onResolve({ filter: /^(\.\/|\.\.\/|@\/)/ }, (args) => {
              const resolved = resolveFilePath(args.importer, args.path, files)
              if (resolved) {
                return { path: resolved, namespace: 'virtual' }
              }
              return { errors: [{ text: `Could not resolve "${args.path}" from "${args.importer}"` }] }
            })

            // Load virtual files from the in-memory file map
            build.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => {
              const content = files[args.path]
              if (content === undefined) {
                return { errors: [{ text: `File not found: ${args.path}` }] }
              }
              const loader = getLoader(args.path)
              // Collect CSS separately
              if (loader === 'css') {
                // Strip @tailwind directives (handled by CDN play script)
                const cleanedCss = content
                  .replace(/@tailwind\s+(base|components|utilities);?\s*/g, '')
                  .trim()
                if (cleanedCss) collectedCss += '\n' + cleanedCss
                return { contents: '', loader: 'js' }
              }
              return { contents: content, loader }
            })

            // Handle entry point resolution
            build.onResolve({ filter: /^src\/main\.tsx$/ }, () => {
              return { path: 'src/main.tsx', namespace: 'virtual' }
            })
          },
        },
      ],
    })

    const js = result.outputFiles?.find(f => f.path.endsWith('.js'))?.text || ''
    const css = collectedCss
    const warnings = result.warnings.map(w => `${w.text} (${w.location?.file}:${w.location?.line})`)
    const errors = result.errors.map(e => `${e.text} (${e.location?.file}:${e.location?.line})`)

    return { js, css, warnings, errors }
  } catch (err: any) {
    // esbuild throws on fatal errors
    const errorMsg = err.message || String(err)
    // Parse esbuild error messages into readable format
    const errors = err.errors
      ? err.errors.map((e: any) => `${e.text}${e.location ? ` (${e.location.file}:${e.location.line})` : ''}`)
      : [errorMsg]

    return { js: '', css: '', warnings: [], errors }
  }
}
