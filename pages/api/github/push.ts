import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { composePage } from '../../../lib/composePage'
import { getAuthUser } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  // Verify server-side session
  const sessionUserId = await getAuthUser(req, res)
  if (!sessionUserId) return res.status(401).json({ error: 'Not authenticated' })

  const { projectId, githubToken, repoName, isPrivate = true } = req.body
  const userId = sessionUserId

  if (!projectId || !githubToken) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  // Verify user owns the project
  const { data: project } = await supabase
    .from('projects').select('*').eq('id', projectId).eq('user_id', userId).single()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const safeName = (repoName || project.name)
    .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

  const headers = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  }

  try {
    // Check if repo exists, create if not
    const repoCheck = await fetch(`https://api.github.com/repos/${await getGitHubUsername(githubToken)}/${safeName}`, { headers })

    if (repoCheck.status === 404) {
      const createRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: safeName,
          description: `${project.name} — Built with Custom AI Dashboard`,
          private: isPrivate,
          auto_init: true,
        }),
      })
      if (!createRes.ok) {
        const err = await createRes.json()
        return res.status(500).json({ error: `Failed to create repo: ${err.message}` })
      }
      await new Promise(r => setTimeout(r, 2000))
    }

    const owner = await getGitHubUsername(githubToken)
    const filesToPush: Array<{ path: string; content: string }> = []

    if (project.project_type === 'react') {
      // --- REACT PROJECT: Push actual project files ---
      const { data: projectFiles } = await supabase
        .from('project_files').select('path, content').eq('project_id', projectId)
      if (!projectFiles || projectFiles.length === 0) {
        return res.status(400).json({ error: 'No files to export' })
      }

      for (const file of projectFiles) {
        if (file.path === '.env') continue // Never push .env
        filesToPush.push({ path: file.path, content: file.content || '' })
      }

      // Add README
      filesToPush.push({
        path: 'README.md',
        content: `# ${project.name}\n\nReact + Vite + Tailwind project built with [Custom AI Dashboard](${process.env.NEXT_PUBLIC_APP_URL || 'https://customaidashboard.com'}).\n\n## Setup\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n## Environment Variables\n\nCreate a \`.env\` file:\n\n\`\`\`\nVITE_SUPABASE_URL=your_supabase_url\nVITE_SUPABASE_ANON_KEY=your_supabase_anon_key\n\`\`\`\n`,
      })
    } else {
      // --- HTML PROJECT: Push composed HTML pages (existing logic) ---
      const { data: pages } = await supabase
        .from('pages').select('*').eq('project_id', projectId).order('created_at', { ascending: true })
      if (!pages || pages.length === 0) return res.status(400).json({ error: 'No pages to export' })

      for (const page of pages) {
        const composed = composePage(
          project.layout_code || null,
          page.code,
          pages,
          page.name,
          projectId
        )
        const safePName = page.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
        filesToPush.push({
          path: safePName === pages[0].name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
            ? 'index.html'
            : `${safePName}.html`,
          content: composed,
        })
      }

      if (!filesToPush.some(f => f.path === 'index.html')) {
        filesToPush.push({ ...filesToPush[0], path: 'index.html' })
      }

      filesToPush.push({
        path: 'README.md',
        content: `# ${project.name}\n\nBuilt with [Custom AI Dashboard](${process.env.NEXT_PUBLIC_APP_URL || 'https://customaidashboard.com'}).\n\n## Pages\n${pages.map(p => `- ${p.name}`).join('\n')}\n`,
      })
    }

    // Push each file using the Contents API
    for (const file of filesToPush) {
      // Check if file exists (need SHA to update)
      const existingRes = await fetch(
        `https://api.github.com/repos/${owner}/${safeName}/contents/${file.path}`,
        { headers }
      )
      const existing = existingRes.ok ? await existingRes.json() : null

      await fetch(
        `https://api.github.com/repos/${owner}/${safeName}/contents/${file.path}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            message: `Update ${file.path} from Custom AI Dashboard`,
            content: Buffer.from(file.content).toString('base64'),
            ...(existing?.sha ? { sha: existing.sha } : {}),
          }),
        }
      )
    }

    const repoUrl = `https://github.com/${owner}/${safeName}`
    res.status(200).json({ url: repoUrl, repo: `${owner}/${safeName}` })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}

async function getGitHubUsername(token: string): Promise<string> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })
  const data = await res.json()
  return data.login
}
