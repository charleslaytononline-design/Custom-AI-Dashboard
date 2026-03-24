import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { composePage } from '../../lib/composePage'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { projectId, userId } = req.body
  if (!userId || !projectId) return res.status(400).json({ error: 'Missing projectId or userId' })

  // Verify user owns the project
  const { data: project } = await supabase
    .from('projects').select('*').eq('id', projectId).eq('user_id', userId).single()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  // Fetch all pages
  const { data: pages } = await supabase
    .from('pages').select('*').eq('project_id', projectId).order('created_at', { ascending: true })
  if (!pages || pages.length === 0) return res.status(400).json({ error: 'No pages to deploy' })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://login.customaidashboard.com'
  const vercelToken = process.env.VERCEL_DEPLOY_TOKEN

  if (!vercelToken) {
    return res.status(500).json({ error: 'Deployment not configured. Set VERCEL_DEPLOY_TOKEN in environment.' })
  }

  try {
    // Build the deployment files
    const files: Array<{ file: string; data: string }> = []

    // Generate composed HTML for each page
    for (const page of pages) {
      const composed = composePage(
        project.layout_code || null,
        page.code,
        pages,
        page.name,
        projectId
      )
      // Replace relative /api/db with absolute URL for deployed apps
      const deployCode = composed.replace(
        /fetch\(['"]\/api\/db['"]/g,
        `fetch('${appUrl}/api/db'`
      )
      const safeName = page.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      files.push({
        file: safeName === pages[0].name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
          ? 'index.html'
          : `${safeName}.html`,
        data: Buffer.from(deployCode).toString('base64'),
      })
    }

    // Also create index.html if the first page wasn't named index
    if (!files.some(f => f.file === 'index.html')) {
      files.push({
        ...files[0],
        file: 'index.html',
      })
    }

    // Deploy to Vercel using the Deployments API
    const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: project.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
        files: files.map(f => ({
          file: f.file,
          data: f.data,
          encoding: 'base64',
        })),
        projectSettings: {
          framework: null, // Static files
        },
        target: 'production',
      }),
    })

    const deployData = await deployRes.json()

    if (!deployRes.ok) {
      return res.status(500).json({
        error: 'Deployment failed',
        detail: deployData.error?.message || JSON.stringify(deployData),
      })
    }

    const deployUrl = `https://${deployData.url}`

    // Save deployment record
    await supabase.from('deployments').insert({
      project_id: projectId,
      user_id: userId,
      url: deployUrl,
      status: 'success',
      provider: 'vercel',
      metadata: {
        deployment_id: deployData.id,
        pages_count: pages.length,
      },
    })

    res.status(200).json({
      url: deployUrl,
      deploymentId: deployData.id,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
