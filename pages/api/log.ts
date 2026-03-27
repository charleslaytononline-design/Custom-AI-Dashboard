import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { getAuthUser } from '../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  // Auth is optional for logging (login page, error handlers fire before auth)
  // but we tag the source so we can distinguish authenticated vs anonymous logs
  const sessionUserId = await getAuthUser(req, res)

  const { event_type, severity = 'info', message, email, metadata } = req.body

  if (!event_type || !message) {
    return res.status(400).json({ error: 'event_type and message required' })
  }

  // Resolve email: use provided email, or look up from authenticated session
  let resolvedEmail = email || null
  if (!resolvedEmail && sessionUserId) {
    try {
      const { data: profile } = await supabase.from('profiles').select('email').eq('id', sessionUserId).single()
      resolvedEmail = profile?.email || null
    } catch { /* don't fail logging if profile lookup fails */ }
  }

  // Compute fingerprint for dedup and tracking (event_type + first 100 chars of message)
  const fingerprint = crypto.createHash('md5').update(`${event_type}:${(message || '').slice(0, 100)}`).digest('hex')

  // Insert the log entry (tag with authenticated userId if available)
  const enrichedMetadata = {
    ...metadata,
    _authenticated: !!sessionUserId,
    _sessionUserId: sessionUserId || undefined,
    _referer: req.headers.referer || undefined,
    _userAgent: (req.headers['user-agent'] || '').slice(0, 200) || undefined,
  }
  await supabase.from('platform_logs').insert({ event_type, severity, message, email: resolvedEmail, metadata: enrichedMetadata, fingerprint })

  // Check if an email alert should fire for this event type
  const { data: setting } = await supabase
    .from('log_alert_settings')
    .select('send_email')
    .eq('event_type', event_type)
    .single()

  if (setting?.send_email && process.env.RESEND_API_KEY) {
    const alertEmail = process.env.ALERT_TO_EMAIL || 'charleslayton.online@gmail.com'
    const fromEmail = process.env.ALERT_FROM_EMAIL || 'alerts@resend.dev'

    const metaHtml = metadata
      ? `<pre style="background:#f4f4f4;padding:12px;border-radius:6px;font-size:12px;overflow:auto">${JSON.stringify(metadata, null, 2)}</pre>`
      : ''

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: alertEmail,
        subject: `[Dashboard Alert] ${event_type}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#7c6ef7;margin-bottom:4px">Platform Alert</h2>
            <p style="color:#888;font-size:13px;margin-bottom:20px">${new Date().toUTCString()}</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr><td style="padding:8px 0;color:#666;width:120px">Event</td><td style="padding:8px 0;font-weight:600">${event_type}</td></tr>
              <tr><td style="padding:8px 0;color:#666">Severity</td><td style="padding:8px 0">${severity}</td></tr>
              ${resolvedEmail ? `<tr><td style="padding:8px 0;color:#666">Email</td><td style="padding:8px 0">${resolvedEmail}</td></tr>` : ''}
              <tr><td style="padding:8px 0;color:#666;vertical-align:top">Message</td><td style="padding:8px 0">${message}</td></tr>
            </table>
            ${metaHtml}
          </div>`,
      }),
    }).catch(() => {/* don't fail the log if email errors */})
  }

  res.status(200).json({ ok: true })
}
