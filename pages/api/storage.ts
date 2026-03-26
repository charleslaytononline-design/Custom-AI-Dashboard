/**
 * Storage upload/delete/list endpoint for project files.
 * Files are stored in project-specific Supabase Storage buckets.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { getAuthUser } from '../../lib/apiAuth'
import { isValidUUID, sanitizeError } from '../../lib/validation'
import { checkRateLimit } from '../../lib/rateLimit'

export const config = {
  api: { bodyParser: { sizeLimit: '6mb' } },
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const clientsDb = process.env.CLIENTS_SUPABASE_URL && process.env.CLIENTS_SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.CLIENTS_SUPABASE_URL, process.env.CLIENTS_SUPABASE_SERVICE_ROLE_KEY)
  : null

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!clientsDb) return res.status(503).json({ error: 'Storage not configured' })

  const sessionUserId = await getAuthUser(req, res)
  if (!sessionUserId) return res.status(401).json({ error: 'Not authenticated' })

  const { projectId, action, filePath, fileBase64, contentType } = req.body

  if (!projectId || !action) return res.status(400).json({ error: 'projectId and action required' })
  if (!isValidUUID(projectId)) return res.status(400).json({ error: 'Invalid project ID' })

  // Rate limit
  if (!checkRateLimit(`storage:${sessionUserId}`, 20, 60_000)) {
    return res.status(429).json({ error: 'Upload rate limit exceeded' })
  }

  // Verify ownership
  const { data: project } = await supabase
    .from('projects').select('id, user_id').eq('id', projectId).eq('user_id', sessionUserId).single()
  if (!project) return res.status(404).json({ error: 'Project not found' })

  const bucketName = `proj-${projectId}`

  try {
    if (action === 'upload') {
      if (!filePath || !fileBase64 || !contentType) {
        return res.status(400).json({ error: 'filePath, fileBase64, and contentType required' })
      }

      // Validate content type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'application/pdf', 'text/csv']
      if (!allowedTypes.includes(contentType)) {
        return res.status(400).json({ error: 'File type not allowed' })
      }

      // Validate file path (no traversal)
      if (filePath.includes('..') || filePath.startsWith('/')) {
        return res.status(400).json({ error: 'Invalid file path' })
      }

      // Decode base64
      const buffer = Buffer.from(fileBase64, 'base64')

      // Check size (5MB)
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'File too large (max 5MB)' })
      }

      const { data, error } = await clientsDb.storage
        .from(bucketName)
        .upload(filePath, buffer, { contentType, upsert: true })

      if (error) return res.status(200).json({ success: false, error: sanitizeError(error) })

      // Get public URL
      const { data: urlData } = clientsDb.storage.from(bucketName).getPublicUrl(filePath)

      // Log upload
      supabase.from('platform_logs').insert({
        event_type: 'storage_upload',
        severity: 'info',
        message: `File uploaded: ${filePath} (${buffer.length} bytes)`,
        metadata: { userId: sessionUserId, projectId, filePath, size: buffer.length },
      }).then(() => {}, () => {})

      return res.status(200).json({ success: true, path: data?.path, publicUrl: urlData?.publicUrl })
    }

    if (action === 'delete') {
      if (!filePath) return res.status(400).json({ error: 'filePath required' })

      const { error } = await clientsDb.storage.from(bucketName).remove([filePath])
      if (error) return res.status(200).json({ success: false, error: sanitizeError(error) })

      return res.status(200).json({ success: true })
    }

    if (action === 'list') {
      const folder = filePath || ''
      const { data, error } = await clientsDb.storage.from(bucketName).list(folder, { limit: 100 })
      if (error) return res.status(200).json({ success: false, error: sanitizeError(error) })

      return res.status(200).json({ success: true, files: data || [] })
    }

    return res.status(400).json({ error: 'Unknown action. Use: upload, delete, list' })
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeError(err) })
  }
}
