import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { projectId, userId, domain, action = 'add' } = req.body
  if (!userId || !projectId || !domain) {
    return res.status(400).json({ error: 'Missing projectId, userId, or domain' })
  }

  const vercelToken = process.env.VERCEL_DEPLOY_TOKEN
  if (!vercelToken) return res.status(500).json({ error: 'Deployment not configured' })

  // Verify ownership
  const { data: project } = await supabase
    .from('projects').select('name').eq('id', projectId).eq('user_id', userId).single()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  // Get the most recent deployment's Vercel project ID
  const { data: deployment } = await supabase
    .from('deployments')
    .select('vercel_project_id, metadata')
    .eq('project_id', projectId)
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  // Try to get vercel_project_id from deployment or metadata
  const vercelProjectId = deployment?.vercel_project_id || deployment?.metadata?.vercel_project_id
  if (!vercelProjectId) {
    return res.status(400).json({ error: 'Deploy the project first before adding a custom domain' })
  }

  try {
    if (action === 'add') {
      // Add domain to Vercel project
      const addRes = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectId}/domains`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${vercelToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
      })

      const addData = await addRes.json()

      if (!addRes.ok) {
        return res.status(500).json({
          error: 'Failed to add domain',
          detail: addData.error?.message || JSON.stringify(addData),
        })
      }

      // Save custom domain to deployment record
      await supabase
        .from('deployments')
        .update({ custom_domain: domain })
        .eq('project_id', projectId)
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(1)

      // Return DNS configuration instructions
      const isApex = !domain.includes('.') || domain.split('.').length === 2
      res.status(200).json({
        success: true,
        domain,
        dns: isApex
          ? { type: 'A', name: '@', value: '76.76.21.21', note: 'Add an A record pointing to 76.76.21.21' }
          : { type: 'CNAME', name: domain.split('.')[0], value: 'cname.vercel-dns.com', note: `Add a CNAME record pointing to cname.vercel-dns.com` },
        verification: addData.verification || null,
      })
    } else if (action === 'remove') {
      // Remove domain from Vercel project
      const removeRes = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectId}/domains/${domain}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${vercelToken}` },
      })

      if (!removeRes.ok) {
        const removeData = await removeRes.json()
        return res.status(500).json({ error: 'Failed to remove domain', detail: removeData.error?.message })
      }

      await supabase
        .from('deployments')
        .update({ custom_domain: null })
        .eq('project_id', projectId)
        .eq('custom_domain', domain)

      res.status(200).json({ success: true, removed: domain })
    } else if (action === 'verify') {
      // Check domain verification status
      const verifyRes = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectId}/domains/${domain}`, {
        headers: { Authorization: `Bearer ${vercelToken}` },
      })

      const verifyData = await verifyRes.json()
      res.status(200).json({
        domain,
        verified: verifyData.verified || false,
        verification: verifyData.verification || null,
      })
    } else {
      res.status(400).json({ error: 'Invalid action. Use add, remove, or verify.' })
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
