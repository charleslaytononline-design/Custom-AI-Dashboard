import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { composePage, composePreviewApp } from '../../../lib/composePage'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const NOT_FOUND = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{margin:0;background:#0a0a0a;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#555}</style>
</head><body><div style="text-align:center"><div style="font-size:32px;margin-bottom:12px">404</div><div>Page not found</div></div></body></html>`

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  const { pageId, content_only } = req.query
  if (!pageId || typeof pageId !== 'string') return res.status(400).end()

  const { data: page } = await supabase
    .from('pages')
    .select('id, code, name, project_id')
    .eq('id', pageId)
    .single()

  if (!page?.code) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(404).send(NOT_FOUND)
  }

  // Fetch project layout and all pages for navigation
  const [{ data: project }, { data: allPages }] = await Promise.all([
    supabase.from('projects').select('layout_code').eq('id', page.project_id).single(),
    supabase.from('pages').select('id, name').eq('project_id', page.project_id).order('created_at', { ascending: true }),
  ])

  const layout = project?.layout_code || null
  const pages = allPages || []

  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')

  // content_only mode: return just the page content (for client-side navigation in standalone preview)
  if (content_only === 'true') {
    // Extract body content if it's a full HTML doc
    const bodyMatch = page.code.match(/<body[^>]*>([\s\S]*)<\/body>/i)
    const content = bodyMatch ? bodyMatch[1].trim() : page.code
    return res.status(200).send(content)
  }

  // Full preview: compose layout + page with standalone navigation
  if (layout) {
    const html = composePreviewApp(layout, page.code, pages, page.name, page.id)
    return res.status(200).send(html)
  }

  // Legacy: no layout, serve raw page
  res.status(200).send(page.code)
}
