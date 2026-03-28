/**
 * Prompt builders for the parallel file generation system.
 *
 * buildParallelPlanPrompt()  — produces the plan-mode system prompt that
 *                              instructs Claude to output a JSON manifest.
 * buildSingleFilePrompt()   — produces the per-file system prompt for
 *                              generating one file in isolation.
 */

import type { ProjectFile } from './virtualFS'
import { getDesignSystemPrompt } from './reactPromptBuilder'
import { generateFileSummaries } from './fileSummarizer'

/* ── Types ──────────────────────────────────────────────────────── */

export interface PlanFile {
  path: string
  description: string
  layer: number
  exports: string[]
  props?: string
  imports: string[]
}

export interface PlanTable {
  name: string
  columns: Array<{ name: string; type: string; primaryKey?: boolean; default?: string }>
}

export interface PlanManifest {
  mode: 'parallel' | 'single'
  message: string
  sharedTypes?: string
  files: PlanFile[]
  tables?: PlanTable[]
  packages?: string[]
}

/* ── Plan prompt ────────────────────────────────────────────────── */

export function buildParallelPlanPrompt(options: {
  projectName: string
  projectId: string
  allFiles: ProjectFile[]
  userPrompt: string
  hasClientsDb: boolean
}): string {
  const { projectName, projectId, allFiles, userPrompt, hasClientsDb } = options

  const fileTree = allFiles.length > 0
    ? allFiles.map(f => `  ${f.path}`).join('\n')
    : '  (empty project)'

  const summaries = generateFileSummaries(allFiles, new Set())
  const summarySection = summaries.length > 0
    ? `\nEXISTING FILE SUMMARIES:\n${summaries.map(s => `  ${s.path} — ${s.summary}`).join('\n')}`
    : ''

  // Include key existing file contents so the planner knows what already exists (Bug 10)
  let existingCode = ''
  const appFile = allFiles.find(f => f.path === 'src/App.tsx')
  const layoutFile = allFiles.find(f => f.path === 'src/components/Layout.tsx')
  if (appFile?.content && appFile.content.length > 60) {
    existingCode += `\n--- src/App.tsx ---\n${appFile.content}\n`
  }
  if (layoutFile?.content) {
    existingCode += `\n--- src/components/Layout.tsx ---\n${layoutFile.content}\n`
  }

  return `You are a build planner for an AI app builder. You analyse the user's request and produce a JSON build manifest.

PROJECT: "${projectName}" (ID: ${projectId})

EXISTING FILES:
${fileTree}
${summarySection}
${existingCode ? `\nEXISTING CODE (modify, don't recreate):\n${existingCode}` : ''}

USER REQUEST: "${userPrompt}"

YOUR TASK:
Analyse the request and decide whether it needs parallel file generation or a simple single-call build.

RULES:
- If the request requires creating 3 or more NEW files → set mode to "parallel"
- If the request edits 1-2 existing files or creates <=2 files → set mode to "single"
- Layer 0 = files with no dependencies on other new files (types, utils, hooks, contexts)
- Layer 1 = components that depend on layer-0 files
- Layer 2 = pages that depend on layer-0 and layer-1 files
- Layer 3+ = App.tsx and any file that depends on everything
- App.tsx is ALWAYS the highest layer (generated last)
- exports: list the named exports and/or "default" for default exports
- imports: list only paths of OTHER new files this file will import from (not npm packages)
- props: for React components, describe the component's props interface
${hasClientsDb ? `- If database tables are needed, include them in the "tables" array with columns
- Always include id (uuid, primaryKey) + created_at (timestamptz, default now())
- Default values for strings must be single-quoted: "default":"'pending'" (NOT "default":"pending")` : ''}

AUTHENTICATION:
When the user requests login, auth, or protected routes, include these files in the plan:
- src/contexts/AuthContext.tsx (layer 0) — exports: AuthProvider, useAuth
- src/pages/Login.tsx (layer 2) — exports: default
- src/pages/Signup.tsx (layer 2) — exports: default
- src/components/ProtectedRoute.tsx (layer 1) — exports: default
- Include a "profiles" table in the tables array
- App.tsx must wrap routes in AuthProvider and use ProtectedRoute

MULTI-PAGE APPS:
When building apps with 2+ pages:
- Always include src/components/Layout.tsx (layer 1) — sidebar/nav with Outlet
- All pages in src/pages/ (layer 2) with descriptive route paths
- App.tsx (highest layer) uses React Router with Layout wrapping nested routes

OUTPUT FORMAT:
Respond with ONLY a JSON object matching this schema — no markdown, no explanation, no code fences:

{
  "mode": "parallel" | "single",
  "message": "Brief description of what will be built",
  "sharedTypes": "Optional: TypeScript interfaces/types that multiple files share (raw TS code)",
  "files": [
    {
      "path": "src/types/index.ts",
      "description": "Shared type definitions",
      "layer": 0,
      "exports": ["Task", "User", "Project"],
      "imports": []
    },
    {
      "path": "src/components/TaskCard.tsx",
      "description": "Card component displaying a single task",
      "layer": 1,
      "exports": ["TaskCard"],
      "props": "{ task: Task; onUpdate: (task: Task) => void; onDelete: (id: string) => void }",
      "imports": ["src/types/index.ts"]
    },
    {
      "path": "src/App.tsx",
      "description": "Root component with React Router",
      "layer": 3,
      "exports": ["default"],
      "imports": ["src/pages/Dashboard.tsx", "src/pages/Settings.tsx"]
    }
  ],
  "tables": [
    {
      "name": "tasks",
      "columns": [
        { "name": "id", "type": "uuid", "primaryKey": true },
        { "name": "title", "type": "text" },
        { "name": "completed", "type": "boolean", "default": "false" },
        { "name": "user_id", "type": "uuid" },
        { "name": "created_at", "type": "timestamptz", "default": "now()" }
      ]
    }
  ],
  "packages": ["recharts"]
}`
}

/* ── Single-file generation prompt ──────────────────────────────── */

export function buildSingleFilePrompt(options: {
  filePath: string
  fileDescription: string
  fileExports: string[]
  props?: string
  fileImports?: string[]
  contracts: Record<string, string>
  existingFiles: ProjectFile[]
  projectName: string
  projectId: string
  hasClientsDb: boolean
  planManifest?: PlanManifest
}): string {
  const {
    filePath, fileDescription, fileExports, props, fileImports,
    contracts, existingFiles, projectName, projectId, hasClientsDb,
    planManifest,
  } = options

  // Compact file tree — just paths, no content
  const fileTree = existingFiles.map(f => `  ${f.path}`).join('\n')

  // Only include contracts from files this file directly imports (not ALL generated files)
  const importSet = new Set(fileImports || [])
  let contractsSection = ''
  const relevantContracts = Object.entries(contracts).filter(([path]) =>
    importSet.has(path) || path === 'src/types/index.ts' // always include shared types
  )
  if (relevantContracts.length > 0) {
    contractsSection = `\nFILES YOU IMPORT FROM:\n`
    for (const [path, content] of relevantContracts) {
      contractsSection += `\n--- ${path} ---\n${content}\n`
    }
  }
  // Show remaining generated files as one-line summaries (so AI knows they exist)
  const otherContracts = Object.entries(contracts).filter(([path]) => !importSet.has(path) && path !== 'src/types/index.ts')
  if (otherContracts.length > 0) {
    contractsSection += `\nOther generated files (available to import): ${otherContracts.map(([p]) => p).join(', ')}\n`
  }

  // Only show supabase.ts content if this file likely uses database
  const fileUsesDb = fileDescription.toLowerCase().match(/database|supabase|fetch|crud|table|data|api|query|realtime/)
    || importSet.has('src/lib/supabase.ts')
  let existingContext = ''
  if (fileUsesDb) {
    const supabaseFile = existingFiles.find(f => f.path === 'src/lib/supabase.ts')
    if (supabaseFile?.content) {
      existingContext += `\n--- src/lib/supabase.ts ---\n${supabaseFile.content}\n`
    }
  }
  // Only show utils if this file imports it
  if (importSet.has('src/lib/utils.ts')) {
    const utilsFile = existingFiles.find(f => f.path === 'src/lib/utils.ts')
    if (utilsFile?.content) {
      existingContext += `\n--- src/lib/utils.ts ---\n${utilsFile.content}\n`
    }
  }

  // Detect if this is an auth-related file
  const isAuthFile = /AuthContext|ProtectedRoute|Login|Signup|useAuth/i.test(filePath)
  const planHasAuth = planManifest?.files?.some(f =>
    /AuthContext|ProtectedRoute|Login|Signup/i.test(f.path)
  ) ?? false

  let authSection = ''
  if (isAuthFile && planHasAuth) {
    authSection = `
AUTH SCAFFOLDING:
- AuthContext.tsx: React context with AuthProvider + useAuth hook. Use supabase.auth.getSession() on mount, onAuthStateChange() for updates. Expose: { user, session, loading, signIn, signUp, signOut }. signUp inserts profile row.
- ProtectedRoute.tsx: useAuth() check → loading spinner → redirect /login → <Outlet />
- Login.tsx: email+password, signIn(), link to /signup, error display, redirect on success
- Signup.tsx: email+password+confirm, signUp(), link to /login
- Always import { supabase } from '../lib/supabase'
`
  }

  // Only include DB section for files that actually use the database
  let dbSection = ''
  if (hasClientsDb && fileUsesDb) {
    dbSection = `
DB OPS (import { supabase } from '../lib/supabase'):
  select: supabase.from('table').select('*').order('created_at', { ascending: false })
  insert: supabase.from('table').insert({ field: 'value' })
  update: supabase.from('table').update({ field: 'new' }).eq('id', id)
  delete: supabase.from('table').delete().eq('id', id)
  realtime: supabase.channel('ch').on('postgres_changes', { event: '*', schema: 'public', table: 'name' }, handler).subscribe()
Always handle { data, error }. Show loading states. Show error messages.
`
  }

  // Compact design system — stripped of security rules (already in plan prompt)
  const compactDesign = `TECH STACK: React 18 + TypeScript, React Router v6, Tailwind CSS, Lucide React icons, Supabase JS client
DESIGN: bg-gray-950 page | bg-gray-900 border-white/5 rounded-xl cards | bg-brand hover:bg-brand/80 buttons | text-white primary, text-white/70 secondary
CONVENTIONS: Functional components + hooks, default exports for pages, named exports for shared components, TypeScript interfaces for all props`

  return `You are an expert React developer generating a single file for project "${projectName}".

FILE TO GENERATE: ${filePath}
PURPOSE: ${fileDescription}
EXPECTED EXPORTS: ${fileExports.join(', ')}
${props ? `COMPONENT PROPS: ${props}` : ''}

PROJECT FILES:
${fileTree}
${contractsSection}${existingContext}

${compactDesign}
${authSection}${dbSection}

OUTPUT RULES:
- Output ONLY raw TypeScript/TSX — no markdown fences, no FILE_OP tags, no explanation
- Use relative imports or '@/' alias for src/ paths
- Export exactly: ${fileExports.join(', ')}
- Write complete, functional code — no TODOs, no placeholders, no comments
- Handle loading/error states for async ops. Use proper TS types — avoid 'any'
- ALL files under src/. Follow the design system.`
}

/* ── App.tsx generation prompt (final step) ─────────────────────── */

export function buildAppTsxPrompt(options: {
  allGeneratedFiles: Record<string, string>
  existingFiles: ProjectFile[]
  projectName: string
  hasRouter: boolean
  planManifest?: PlanManifest
}): string {
  const { allGeneratedFiles, existingFiles, projectName, hasRouter, planManifest } = options

  // Show what pages and components exist
  const pages = Object.keys(allGeneratedFiles).filter(p => p.startsWith('src/pages/'))
  const components = Object.keys(allGeneratedFiles).filter(p => p.startsWith('src/components/'))
  const contexts = Object.keys(allGeneratedFiles).filter(p => p.startsWith('src/contexts/'))

  // Check if existing Layout component exists
  const hasLayout = !!allGeneratedFiles['src/components/Layout.tsx'] || existingFiles.some(f => f.path === 'src/components/Layout.tsx')

  // Check if auth files exist (Bug 5 — App.tsx needs to wrap with AuthProvider)
  const hasAuth = !!allGeneratedFiles['src/contexts/AuthContext.tsx'] || existingFiles.some(f => f.path === 'src/contexts/AuthContext.tsx')
  const hasProtectedRoute = !!allGeneratedFiles['src/components/ProtectedRoute.tsx'] || existingFiles.some(f => f.path === 'src/components/ProtectedRoute.tsx')
  const loginPage = pages.find(p => p.toLowerCase().includes('login'))
  const signupPage = pages.find(p => p.toLowerCase().includes('signup'))

  // Show export signatures from generated files so App.tsx knows what to import
  let fileExports = ''
  for (const [path, content] of Object.entries(allGeneratedFiles)) {
    if (path === 'src/App.tsx') continue
    const defaultMatch = content.match(/export\s+default\s+(?:function|class|const)\s+(\w+)/)
    const namedExports: string[] = []
    const namedRegex = /export\s+(?:function|const|class|interface|type)\s+(\w+)/g
    let nm: RegExpExecArray | null
    while ((nm = namedRegex.exec(content)) !== null) namedExports.push(nm[1])
    const exports = namedExports.join(', ')
    if (defaultMatch || exports) {
      fileExports += `  ${path}: ${defaultMatch ? `default ${defaultMatch[1]}` : ''}${defaultMatch && exports ? ', ' : ''}${exports}\n`
    }
  }

  // Build auth routing instructions
  let authInstructions = ''
  if (hasAuth) {
    authInstructions = `
AUTH ROUTING (CRITICAL — app will crash without this):
- Import { AuthProvider } from './contexts/AuthContext'
${hasProtectedRoute ? `- Import ProtectedRoute from './components/ProtectedRoute'` : ''}
- Wrap ALL routes in <AuthProvider>
${loginPage ? `- Route /login to Login page OUTSIDE ProtectedRoute (public route)` : ''}
${signupPage ? `- Route /signup to Signup page OUTSIDE ProtectedRoute (public route)` : ''}
${hasProtectedRoute ? `- Wrap protected routes in <Route element={<ProtectedRoute />}>` : ''}

REQUIRED App.tsx structure with auth:
  <AuthProvider>
    <Routes>
      ${loginPage ? '<Route path="/login" element={<Login />} />' : ''}
      ${signupPage ? '<Route path="/signup" element={<Signup />} />' : ''}
      ${hasProtectedRoute ? '<Route element={<ProtectedRoute />}>' : ''}
        ${hasLayout ? '<Route element={<Layout />}>' : ''}
          <Route path="/" element={<MainPage />} />
          {/* other protected routes */}
        ${hasLayout ? '</Route>' : ''}
      ${hasProtectedRoute ? '</Route>' : ''}
    </Routes>
  </AuthProvider>
`
  }

  return `You are generating the root App.tsx for project "${projectName}".

This file is the ENTRY POINT — it MUST import and render ALL page components.
src/main.tsx renders <App />, so App.tsx controls what the user sees.

PAGES TO ROUTE:
${pages.map(p => `  ${p}`).join('\n') || '  (no pages — render main component directly)'}

COMPONENTS AVAILABLE:
${components.map(c => `  ${c}`).join('\n') || '  (none)'}

${contexts.length > 0 ? `CONTEXTS:\n${contexts.map(c => `  ${c}`).join('\n')}` : ''}

${fileExports ? `FILE EXPORTS:\n${fileExports}` : ''}

${hasLayout ? `LAYOUT: A Layout component exists — nest page routes inside <Route element={<Layout />}> so pages render inside Layout via <Outlet />.` : ''}
${authInstructions}

ROUTE STRUCTURE FOR MULTI-PAGE APPS:
${hasLayout ? `  <BrowserRouter>
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  </BrowserRouter>` : ''}

INSTRUCTIONS:
- Output ONLY the raw TypeScript/TSX file content — no markdown, no tags, no explanation
- Import ALL page components from their paths (e.g., './pages/Dashboard')
- ${hasRouter ? 'Use React Router v6: Routes, Route (BrowserRouter is already in main.tsx or add it here)' : 'Render the main component directly'}
- ${hasRouter ? 'Map each page to a route — use "/" for the main page (Dashboard/Home), "/pagename" for others' : ''}
- Export default function App()
- NEVER leave App.tsx as a stub (just <div />) — it MUST render real content
- Import from relative paths (e.g., './pages/Dashboard')
- EVERY page you import must have a <Route> — no orphan imports
- If Layout exists, ALL page routes must be NESTED inside <Route element={<Layout />}>`
}
