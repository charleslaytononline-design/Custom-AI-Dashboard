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

  return `You are a build planner for an AI app builder. You analyse the user's request and produce a JSON build manifest.

PROJECT: "${projectName}" (ID: ${projectId})

EXISTING FILES:
${fileTree}
${summarySection}

USER REQUEST: "${userPrompt}"

YOUR TASK:
Analyse the request and decide whether it needs parallel file generation or a simple single-call build.

RULES:
- If the request requires creating 3 or more NEW files → set mode to "parallel"
- If the request edits 1-2 existing files or creates <=2 files → set mode to "single"
- Layer 0 = files with no dependencies on other new files (types, utils, hooks)
- Layer 1 = components that depend on layer-0 files
- Layer 2 = pages that depend on layer-0 and layer-1 files
- Layer 3+ = App.tsx and any file that depends on everything
- App.tsx is ALWAYS the highest layer (generated last)
- exports: list the named exports and/or "default" for default exports
- imports: list only paths of OTHER new files this file will import from (not npm packages)
- props: for React components, describe the component's props interface
${hasClientsDb ? '- If database tables are needed, include them in the "tables" array with columns\n- Always include id (uuid, primaryKey) + created_at (timestamptz, default now())' : ''}

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
}): string {
  const {
    filePath, fileDescription, fileExports, props,
    contracts, existingFiles, projectName, projectId, hasClientsDb,
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

INSTRUCTIONS:
- Output ONLY the raw TypeScript/TSX file content — no markdown code fences, no FILE_OP tags, no explanation
- Import from other files using relative paths (e.g., import { Task } from '../types')
- Use '@/' alias for src/ imports (e.g., import { supabase } from '@/lib/supabase')
- Export exactly what is listed in EXPECTED EXPORTS
- Follow the design system exactly
- Write complete, functional code — no TODOs or placeholders
${hasClientsDb ? '- Use the Supabase client from src/lib/supabase.ts for any database operations' : ''}
- Write concise TypeScript — no comments, no lorem ipsum
- Handle loading and error states for async operations
- Use proper TypeScript types — avoid 'any'`
}

/* ── App.tsx generation prompt (final step) ─────────────────────── */

export function buildAppTsxPrompt(options: {
  allGeneratedFiles: Record<string, string>
  existingFiles: ProjectFile[]
  projectName: string
  hasRouter: boolean
}): string {
  const { allGeneratedFiles, existingFiles, projectName, hasRouter } = options

  // Show what pages and components exist
  const pages = Object.keys(allGeneratedFiles).filter(p => p.startsWith('src/pages/'))
  const components = Object.keys(allGeneratedFiles).filter(p => p.startsWith('src/components/'))

  // Check if existing Layout component exists
  const hasLayout = !!allGeneratedFiles['src/components/Layout.tsx'] || existingFiles.some(f => f.path === 'src/components/Layout.tsx')

  return `You are generating the root App.tsx for project "${projectName}".

This file is the ENTRY POINT — it MUST import and render ALL page components.
src/main.tsx renders <App />, so App.tsx controls what the user sees.

PAGES TO ROUTE:
${pages.map(p => `  ${p}`).join('\n')}

COMPONENTS AVAILABLE:
${components.map(c => `  ${c}`).join('\n')}

${hasLayout ? 'A Layout component exists — wrap routes in <Layout> with <Outlet /> for nested routing.' : ''}

INSTRUCTIONS:
- Output ONLY the raw TypeScript/TSX file content — no markdown, no tags, no explanation
- Import ALL page components from their paths
- ${hasRouter ? 'Use React Router v6: BrowserRouter, Routes, Route' : 'Render the main component directly'}
- ${hasRouter ? 'Map each page to a route (/ for the main page, /pagename for others)' : ''}
- Export default function App()
- NEVER leave App.tsx as a stub (just <div />) — it MUST render real content
- Import from relative paths (e.g., './pages/Dashboard')`
}
