import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const NOT_FOUND = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{margin:0;background:#0a0a0a;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#555}</style>
</head><body><div style="text-align:center"><div style="font-size:32px;margin-bottom:12px">404</div><div>Page not found</div></div></body></html>`

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  const { pageId } = req.query
  if (!pageId || typeof pageId !== 'string') return res.status(400).end()

  const { data: page } = await supabase
    .from('pages')
    .select('code, name')
    .eq('id', pageId)
    .single()

  if (!page?.code) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(404).send(NOT_FOUND)
  }

  // Cache for 0 seconds so refreshing always gets fresh content
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.status(200).send(page.code)
}
