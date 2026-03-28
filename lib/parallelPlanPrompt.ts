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
  contracts: Record<string, string>
  existingFiles: ProjectFile[]
  projectName: string
  projectId: string
  hasClientsDb: boolean
  planManifest?: PlanManifest
}): string {
  const {
    filePath, fileDescription, fileExports, props,
    contracts, existingFiles, projectName, projectId, hasClientsDb,
    planManifest,
  } = options

  const designSystem = getDesignSystemPrompt()

  // Show existing file tree for context
  const fileTree = existingFiles.map(f => `  ${f.path}`).join('\n')

  // Show contracts from previously generated files
  let contractsSection = ''
  const contractEntries = Object.entries(contracts)
  if (contractEntries.length > 0) {
    contractsSection = `\nALREADY GENERATED FILES (you can import from these):\n`
    for (const [path, content] of contractEntries) {
      contractsSection += `\n--- ${path} ---\n${content}\n`
    }
  }

  // Show relevant existing files (supabase client, utils)
  let existingContext = ''
  const supabaseFile = existingFiles.find(f => f.path === 'src/lib/supabase.ts')
  if (supabaseFile?.content) {
    existingContext += `\n--- src/lib/supabase.ts (existing) ---\n${supabaseFile.content}\n`
  }
  const utilsFile = existingFiles.find(f => f.path === 'src/lib/utils.ts')
  if (utilsFile?.content) {
    existingContext += `\n--- src/lib/utils.ts (existing) ---\n${utilsFile.content}\n`
  }

  // Show summaries of all other existing files so the AI knows what's available to import
  const contractPaths = new Set(Object.keys(contracts))
  const summaries = generateFileSummaries(existingFiles, contractPaths)
  if (summaries.length > 0) {
    existingContext += `\nOTHER EXISTING FILES (can import from these):\n`
    for (const s of summaries) {
      existingContext += `  ${s.path} — ${s.summary}\n`
    }
  }

  // Detect if this is an auth-related file (Bug 5)
  const isAuthFile = /AuthContext|ProtectedRoute|Login|Signup|useAuth/i.test(filePath)
  const planHasAuth = planManifest?.files?.some(f =>
    /AuthContext|ProtectedRoute|Login|Signup/i.test(f.path)
  ) ?? false

  // Build auth scaffolding section for auth-related files
  let authSection = ''
  if (isAuthFile && planHasAuth) {
    authSection = `
AUTH SCAFFOLDING:
- AuthContext.tsx: Create React context with AuthProvider and useAuth hook.
  - Use supabase.auth.getSession() on mount to check existing session
  - Listen to supabase.auth.onAuthStateChange() for auth state updates
  - Expose: { user, session, loading, signIn(email, password), signUp(email, password, name?), signOut() }
  - signUp must insert a profile row after successful signup:
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (data.user && !error) {
      await supabase.from('profiles').insert({ id: data.user.id, email, full_name: name || '', role: 'viewer' })
    }
- ProtectedRoute.tsx: Uses useAuth() to check session, shows loading spinner while checking, redirects to /login if no session, renders <Outlet /> if authenticated.
- Login.tsx: Email + password inputs, "Sign In" button calling useAuth().signIn(), link to /signup, error display, redirect to / on success.
- Signup.tsx: Email + password + confirm password, "Create Account" calling useAuth().signUp(), link to /login.
- Always import { supabase } from '../lib/supabase' for auth operations.
`
  }

  // Build database section (Bug 6)
  let dbSection = ''
  if (hasClientsDb) {
    dbSection = `
DATABASE OPERATIONS (import { supabase } from '../lib/supabase'):
  // Select rows
  const { data, error } = await supabase.from('table_name').select('*').order('created_at', { ascending: false })
  // Insert a row
  const { error } = await supabase.from('table_name').insert({ field: 'value' })
  // Update a row
  const { error } = await supabase.from('table_name').update({ field: 'new_value' }).eq('id', rowId)
  // Delete a row
  const { error } = await supabase.from('table_name').delete().eq('id', rowId)
  // Realtime subscription
  useEffect(() => {
    const channel = supabase.channel('realtime-table')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_name' }, (payload) => {
        if (payload.eventType === 'INSERT') setItems(prev => [payload.new, ...prev])
        if (payload.eventType === 'UPDATE') setItems(prev => prev.map(i => i.id === payload.new.id ? payload.new : i))
        if (payload.eventType === 'DELETE') setItems(prev => prev.filter(i => i.id !== payload.old.id))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])
Always handle { data, error } return values. Show loading states during fetches. Show user-friendly error messages.
`
  }

  return `You are an expert React developer generating a single file for project "${projectName}".

FILE TO GENERATE: ${filePath}
PURPOSE: ${fileDescription}
EXPECTED EXPORTS: ${fileExports.join(', ')}
${props ? `COMPONENT PROPS: ${props}` : ''}

PROJECT FILES:
${fileTree}

${contractsSection}
${existingContext}

${designSystem}
${authSection}
${dbSection}

INSTRUCTIONS:
- Output ONLY the raw TypeScript/TSX file content — no markdown code fences, no FILE_OP tags, no explanation
- Import from other files using relative paths (e.g., import { Task } from '../types')
- Use '@/' alias for src/ imports (e.g., import { supabase } from '@/lib/supabase')
- Export exactly what is listed in EXPECTED EXPORTS
- Follow the design system exactly
- Write complete, functional code — no TODOs or placeholders
- Write concise TypeScript — no comments, no lorem ipsum
- Handle loading and error states for async operations
- Use proper TypeScript types — avoid 'any'
- ALL files MUST be under src/ — files outside src/ will NOT be bundled
- Every component you create must be importable from the path listed in FILE TO GENERATE`
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
    const namedMatches = [...content.matchAll(/export\s+(?:function|const|class|interface|type)\s+(\w+)/g)]
    const exports = namedMatches.map(m => m[1]).join(', ')
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
