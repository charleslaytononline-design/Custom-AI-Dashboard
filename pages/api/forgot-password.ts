import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email is required' })

  // Always return success to avoid revealing whether an account exists
  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `https://${req.headers.host}`

    const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${siteUrl}/reset-password` },
    })

    if (linkError || !linkData?.properties?.action_link) {
      // User may not exist or link generation failed — return success anyway
      return res.json({ ok: true })
    }

    const resetUrl = linkData.properties.action_link
    const fromEmail = process.env.ALERT_FROM_EMAIL || 'noreply@resend.dev'

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: email,
        subject: 'Reset your Custom AI Dashboard password',
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:40px 20px;background:#0a0a0a;color:#f0f0f0">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:32px">
              <div style="width:40px;height:40px;background:#7c6ef7;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:white">AI</div>
              <div>
                <div style="font-size:16px;font-weight:600">Custom AI Dashboard</div>
                <div style="font-size:12px;color:#666">Build anything with AI</div>
              </div>
            </div>
            <h2 style="font-size:20px;font-weight:600;margin-bottom:8px">Reset your password</h2>
            <p style="color:#888;font-size:14px;line-height:1.6;margin-bottom:28px">
              We received a request to reset your password. Click the button below to choose a new one.
            </p>
            <a href="${resetUrl}" style="display:inline-block;padding:13px 28px;background:#7c6ef7;color:white;border-radius:9px;text-decoration:none;font-weight:600;font-size:14px">
              Reset Password
            </a>
            <p style="color:#555;font-size:12px;margin-top:32px;line-height:1.6">
              If you didn't request a password reset, you can safely ignore this email.<br>
              This link expires in 1 hour.
            </p>
          </div>
        `,
      }),
    })

    await adminSupabase.from('platform_logs').insert({
      event_type: 'password_reset_requested',
      severity: 'info',
      message: `Password reset requested for ${email}`,
      email,
      metadata: { emailSent: true },
    }).catch(() => {})
  } catch {
    // Swallow errors — always return success
  }

  return res.json({ ok: true })
}
