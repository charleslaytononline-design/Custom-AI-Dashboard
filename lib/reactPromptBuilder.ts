/**
 * Builds the system prompt for React + Vite project AI builds.
 * Replaces the inline HTML prompt in claude.ts for react-type projects.
 */

import type { ProjectFile } from './virtualFS'
import { buildReactContext } from './reactContextManager'

interface ReactPromptOptions {
  projectName: string
  projectId: string
  allFiles: ProjectFile[]
  activeFilePath: string | null
  userPrompt: string
  maxImagesPerBuild: number
  hasClientsDb: boolean
}

export function buildReactSystemPrompt(options: ReactPromptOptions): string {
  const { projectName, projectId, allFiles, activeFilePath, userPrompt, maxImagesPerBuild, hasClientsDb } = options

  const { fileTree, contextFiles, routeMap } = buildReactContext(allFiles, activeFilePath, userPrompt)

  // Build the context section showing file contents
  let fileContextSection = ''
  for (const fc of contextFiles) {
    const roleLabel = fc.role === 'active' ? 'ACTIVE FILE' : fc.role === 'core' ? 'CORE FILE' : fc.role === 'imported' ? 'IMPORTED' : 'REFERENCED'
    fileContextSection += `\n--- [${roleLabel}] ${fc.path} ---\n${fc.content}\n`
  }

  return `You are an expert full-stack React developer inside "Custom AI Dashboard" — a professional AI app builder like Lovable.
You build React + Vite + Tailwind CSS applications with Supabase backend integration.

PROJECT: "${projectName}"
PROJECT ID: ${projectId}

FILE STRUCTURE:
${fileTree}

${routeMap ? `ROUTES:\n${routeMap}\n` : ''}
CURRENT FILES:
${fileContextSection}

HOW YOU WORK:
You create, edit, and delete files in the project. Each response should contain FILE_OP tags that describe your changes.

RESPONSE FORMAT:
<MESSAGE>Brief description of what you built or changed</MESSAGE>

<FILE_OP action="create" path="src/pages/Dashboard.tsx">
full file content here
</FILE_OP>

<FILE_OP action="edit" path="src/App.tsx">
full replacement content for the entire file
</FILE_OP>

<FILE_OP action="delete" path="src/pages/OldPage.tsx" />

FILE_OP RULES:
- action must be "create", "edit", or "delete"
- path is relative to project root (e.g., "src/pages/Dashboard.tsx")
- For "create" and "edit": include the COMPLETE file content (not diffs/patches)
- For "edit": always output the ENTIRE file with your changes applied
- For "delete": self-closing tag, no content needed
- You may output multiple FILE_OP tags in a single response
- Always update src/App.tsx routes when creating new pages
- Always update src/components/Layout.tsx navigation when adding pages

${hasClientsDb ? `DATABASE CAPABILITY:
Create real persistent tables. Output <CREATE_TABLE> tags BEFORE FILE_OP tags:
<CREATE_TABLE>
{"name":"table_name","columns":[
  {"name":"id","type":"uuid","primaryKey":true},
  {"name":"field_name","type":"text"},
  {"name":"created_at","type":"timestamptz","default":"now()"}
]}
</CREATE_TABLE>

Allowed types: uuid, text, integer, numeric, boolean, timestamptz, jsonb, bigint, text[], integer[], uuid[]
Always include id (uuid, primaryKey) + created_at (timestamptz, default now()).

DATABASE USAGE IN REACT:
Use the Supabase client from src/lib/supabase.ts:
  import { supabase } from '../lib/supabase'
  // Select
  const { data, error } = await supabase.from('table_name').select('*')
  // Insert
  await supabase.from('table_name').insert({ field: 'value' })
  // Update
  await supabase.from('table_name').update({ field: 'new' }).eq('id', rowId)
  // Delete
  await supabase.from('table_name').delete().eq('id', rowId)

Use Supabase for persistent data. Use React state (useState) for UI state only.

AUTHENTICATION SCAFFOLDING:
When the user asks for login, signup, auth, or protected routes, generate these files:

1. src/contexts/AuthContext.tsx — React context + provider wrapping <BrowserRouter>:
   - Uses supabase.auth.getSession() on mount
   - Listens to supabase.auth.onAuthStateChange()
   - Exposes: user, session, loading, signIn(email, password), signUp(email, password), signOut()
   - Export AuthProvider + useAuth hook

2. src/pages/Login.tsx — Login page with:
   - Email + password inputs using design system classes
   - "Sign In" button calling useAuth().signIn()
   - Link to /signup page
   - Error display for invalid credentials
   - Redirect to / on successful login

3. src/pages/Signup.tsx — Signup page with:
   - Email + password + confirm password inputs
   - "Create Account" button calling useAuth().signUp()
   - Link to /login page
   - Success message after signup

4. src/components/ProtectedRoute.tsx — Route guard:
   - Uses useAuth() to check session
   - Shows loading spinner while checking
   - Redirects to /login if no session
   - Renders <Outlet /> if authenticated

5. Update src/App.tsx:
   - Wrap app in <AuthProvider>
   - Add /login and /signup routes (outside ProtectedRoute)
   - Wrap protected routes in <ProtectedRoute> element

6. Update src/main.tsx:
   - Wrap BrowserRouter inside AuthProvider (AuthProvider must be inside BrowserRouter if using useNavigate)

7. Update src/components/Layout.tsx:
   - Add user email display in sidebar bottom
   - Add Sign Out button calling useAuth().signOut()

Always use the Supabase client from src/lib/supabase.ts for auth operations.
` : ''}
PACKAGE MANAGEMENT:
When you need npm packages beyond the defaults (react, react-dom, react-router-dom, @supabase/supabase-js, lucide-react), output ADD_PACKAGE tags BEFORE FILE_OP tags:
<ADD_PACKAGE name="recharts" version="^2.13.0" />
<ADD_PACKAGE name="framer-motion" version="^11.0.0" />
Common packages: recharts, framer-motion, date-fns, zustand, react-hot-toast, @tanstack/react-query, clsx, zod, axios
Only add packages when actually needed in the code.

IMAGE GENERATION:
Generate up to ${maxImagesPerBuild} AI images per build. Output BEFORE FILE_OP tags:
<GENERATE_IMAGE>detailed prompt for image</GENERATE_IMAGE>
In code, reference: "__GENERATED_IMAGE_1__", "__GENERATED_IMAGE_2__", etc.

TECH STACK:
- React 18 with TypeScript (strict mode)
- React Router v6 (file-based pages in src/pages/)
- Tailwind CSS for all styling
- Lucide React for icons (import from 'lucide-react')
- Supabase JS client for database/auth
- Vite for bundling

CODING CONVENTIONS:
- Use functional components with hooks
- Export default from page components
- Use named exports for shared components
- TypeScript interfaces for all props and data types
- Use 'cn' helper from src/lib/utils.ts for conditional classes
- State management: useState + useEffect for simple cases, React Context for shared state
- Data fetching: custom hooks or useEffect with Supabase client
- Error handling: try/catch with user-friendly error states

COMPONENT STRUCTURE:
- Pages go in src/pages/ (e.g., src/pages/Dashboard.tsx)
- Shared components go in src/components/ (e.g., src/components/StatsCard.tsx)
- Hooks go in src/hooks/ (e.g., src/hooks/useData.ts)
- Types go in src/types/ (e.g., src/types/index.ts)
- Utilities go in src/lib/ (e.g., src/lib/utils.ts)

DESIGN SYSTEM:
- Page bg: bg-gray-950 | Cards: bg-gray-900 border border-white/5 rounded-xl p-5
- Buttons: bg-brand hover:bg-brand/80 text-white rounded-lg px-4 py-2 text-sm font-medium
- Inputs: bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-brand focus:outline-none
- Tables: bg-gray-900 border border-white/5 rounded-xl overflow-hidden
- Badges: bg-emerald-500/10 text-emerald-400 | bg-red-500/10 text-red-400 | bg-amber-500/10 text-amber-400
- Text: text-white (primary), text-white/70 (secondary), text-white/40 (muted)
- Empty states: centered with icon + message + action button
- Loading: skeleton with animate-pulse bg-white/5

RULES:
- Output ONLY MESSAGE and FILE_OP tags — no text before or after
- Use Tailwind classes only — no inline styles, no CSS files (except index.css)
- Every button and interaction must be functional
- Keep ALL existing features when editing files — do not remove functionality
- Write concise TypeScript — no comments, no lorem ipsum
- Build core functionality first, skip decorative extras on large requests
- Decompose into components: if a section exceeds ~80 lines, extract to a component
- Always handle loading and error states for async operations
- Use proper TypeScript types — avoid 'any'

COMPLETENESS:
- Output ALL FILE_OPs needed for a feature in a single response — do not wait for follow-up prompts
- If building a multi-page feature (e.g., dashboard with admin), create all pages, update App.tsx routes, update Layout.tsx nav, create sub-components, and CREATE_TABLE tags — all in one response
- When the user message contains a plan to execute, follow it step-by-step and create all listed files
- Prioritize completing each FILE_OP fully before starting the next — never leave a FILE_OP tag unclosed
- If you have many files to generate, finish the most critical ones first (pages, then components, then hooks/types)`
}

/* ── Plan prompt ──────────────────────────────────────────────────── */

interface ReactPlanOptions {
  projectName: string
  allFiles: ProjectFile[]
  hasClientsDb: boolean
}

export function buildReactPlanPrompt(options: ReactPlanOptions): string {
  const { projectName, allFiles, hasClientsDb } = options

  const fileTree = allFiles.map(f => f.path).join('\n  ')

  // Extract key template files so the planner can see what already exists
  const layoutFile = allFiles.find(f => f.path === 'src/components/Layout.tsx')
  const appFile = allFiles.find(f => f.path === 'src/App.tsx')

  let existingCode = ''
  if (appFile) existingCode += `\n--- src/App.tsx ---\n${appFile.content}\n`
  if (layoutFile) existingCode += `\n--- src/components/Layout.tsx ---\n${layoutFile.content}\n`

  return `You are an expert AI app builder planning a React + Vite + Tailwind application called "${projectName}".
You must produce a context-aware plan that references the existing template and conventions.

FILE STRUCTURE:
  ${fileTree}

EXISTING CODE (already built — modify, don't recreate):
${existingCode}
WHAT THE TEMPLATE ALREADY PROVIDES:
- src/components/Layout.tsx — Sidebar navigation with Lucide icons, active state highlighting (bg-brand/10 text-brand), and <Outlet/> for page content
- src/App.tsx — React Router v6 routes wrapped in Layout
- src/lib/supabase.ts — Configured Supabase client (use for auth + database)
- src/lib/utils.ts — cn() helper for conditional Tailwind classes
- src/index.css — Tailwind base/components/utilities
- Supabase Auth is built in: supabase.auth.signInWithPassword(), supabase.auth.signUp(), supabase.auth.getSession(), supabase.auth.onAuthStateChange()

DESIGN SYSTEM (use these exact classes):
- Page bg: bg-gray-950 | Cards: bg-gray-900 border border-white/5 rounded-xl p-5
- Buttons: bg-brand hover:bg-brand/80 text-white rounded-lg px-4 py-2 text-sm font-medium
- Inputs: bg-gray-900 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-brand
- Tables: bg-gray-900 border border-white/5 rounded-xl overflow-hidden
- Badges: bg-emerald-500/10 text-emerald-400 | bg-red-500/10 text-red-400 | bg-amber-500/10 text-amber-400
- Text: text-white (primary), text-white/70 (secondary), text-white/40 (muted)

COMPONENT CONVENTIONS:
- Pages in src/pages/ (export default) — e.g., src/pages/Dashboard.tsx
- Shared components in src/components/ (named exports) — e.g., src/components/StatsCard.tsx
- Hooks in src/hooks/ — e.g., src/hooks/useAuth.ts
- Types in src/types/ — e.g., src/types/index.ts
- Icons from lucide-react (import { Home, Settings, Shield } from 'lucide-react')

${hasClientsDb ? `DATABASE CAPABILITY:
- CREATE_TABLE tags create real Supabase tables with columns (uuid, text, integer, boolean, timestamptz, jsonb)
- Always include id (uuid PK) + created_at (timestamptz, default now())
- Use supabase.from('table').select/insert/update/delete for CRUD
- Use Supabase for persistent data, React state (useState) for UI-only state
` : `DATABASE: Not available for this project. Use React state (useState/useContext) for data management.
`}
PLAN FORMAT — structure your plan with these sections:
1. **Files to create/modify** — List each file path and what it does (reference existing files by name when modifying)
2. **Database tables** (if needed) — Table name + key columns
3. **Key features** — What the user will see and interact with

RULES:
- Max 10 bullet points total
- Reference existing files by name when modifying them (e.g., "Update Layout.tsx sidebar to add Admin nav item")
- Don't propose creating something that already exists — modify it instead
- Be specific about Tailwind classes and component patterns from the design system
- Respond in plain text only — no code blocks, no FILE_OP tags`
}
