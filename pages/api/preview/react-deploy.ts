import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { projectId, userId } = req.body
  if (!userId || !projectId) return res.status(400).json({ error: 'Missing projectId or userId' })

  const vercelToken = process.env.VERCEL_DEPLOY_TOKEN
  if (!vercelToken) return res.status(500).json({ error: 'Deployment not configured' })

  // Verify ownership
  const { data: project } = await supabase
    .from('projects').select('name, project_type').eq('id', projectId).eq('user_id', userId).single()
  if (!project) return res.status(404).json({ error: 'Project not found' })
  if (project.project_type !== 'react') return res.status(400).json({ error: 'Not a React project' })

  // Fetch all project files
  const { data: files } = await supabase
    .from('project_files').select('path, content').eq('project_id', projectId)
  if (!files || files.length === 0) return res.status(400).json({ error: 'No files to deploy' })

  try {
    const slug = project.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

    // Build Vercel deployment payload
    const vercelFiles = files
      .filter(f => f.path !== '.env') // Don't deploy .env to preview
      .map(f => ({
        file: f.path,
        data: Buffer.from(f.content || '').toString('base64'),
        encoding: 'base64' as const,
      }))

    const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `${slug}-preview`,
        files: vercelFiles,
        projectSettings: {
          framework: 'vite',
          buildCommand: 'npm run build',
          outputDirectory: 'dist',
          installCommand: 'npm install',
        },
        target: 'preview',
      }),
    })

    const deployData = await deployRes.json()

    if (!deployRes.ok) {
      return res.status(500).json({
        error: 'Preview deployment failed',
        detail: deployData.error?.message || JSON.stringify(deployData),
      })
    }

    const previewUrl = `https://${deployData.url}`

    res.status(200).json({
      url: previewUrl,
      deploymentId: deployData.id,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
