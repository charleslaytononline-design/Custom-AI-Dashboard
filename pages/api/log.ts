import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { event_type, severity = 'info', message, email, metadata } = req.body

  if (!event_type || !message) {
    return res.status(400).json({ error: 'event_type and message required' })
  }

  // Insert the log entry
  await supabase.from('platform_logs').insert({ event_type, severity, message, email: email || null, metadata: metadata || null })

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
              ${email ? `<tr><td style="padding:8px 0;color:#666">Email</td><td style="padding:8px 0">${email}</td></tr>` : ''}
              <tr><td style="padding:8px 0;color:#666;vertical-align:top">Message</td><td style="padding:8px 0">${message}</td></tr>
            </table>
            ${metaHtml}
          </div>`,
      }),
    }).catch(() => {/* don't fail the log if email errors */})
  }

  res.status(200).json({ ok: true })
}
