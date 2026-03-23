import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  // Verify admin
  const serverClient = createServerSupabaseClient({ req, res })
  const { data: { session } } = await serverClient.auth.getSession()
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  const { data: profile } = await adminSupabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single()
  if (profile?.role !== 'admin') return res.status(403).json({ error: 'Not authorized' })

  const { userId, email } = req.body
  if (!userId || !email) return res.status(400).json({ error: 'userId and email required' })

  // Generate a fresh confirmation link using admin API (no email sent by Supabase)
  const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
    type: 'signup',
    email,
  })

  if (linkError || !linkData?.properties?.action_link) {
    return res.status(500).json({ error: linkError?.message || 'Failed to generate confirmation link' })
  }

  const confirmUrl = linkData.properties.action_link
  const fromEmail = process.env.ALERT_FROM_EMAIL || 'noreply@resend.dev'

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: email,
      subject: 'Confirm your Custom AI Dashboard account',
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:40px 20px;background:#0a0a0a;color:#f0f0f0">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:32px">
            <div style="width:40px;height:40px;background:#7c6ef7;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:white">AI</div>
            <div>
              <div style="font-size:16px;font-weight:600">Custom AI Dashboard</div>
              <div style="font-size:12px;color:#666">Build anything with AI</div>
            </div>
          </div>
          <h2 style="font-size:20px;font-weight:600;margin-bottom:8px">Confirm your email</h2>
          <p style="color:#888;font-size:14px;line-height:1.6;margin-bottom:28px">
            Please click the button below to confirm your email address and activate your account.
          </p>
          <a href="${confirmUrl}" style="display:inline-block;padding:13px 28px;background:#7c6ef7;color:white;border-radius:9px;text-decoration:none;font-weight:600;font-size:14px">
            Confirm my account
          </a>
          <p style="color:#555;font-size:12px;margin-top:32px;line-height:1.6">
            If you didn't create an account, you can safely ignore this email.<br>
            This link expires in 24 hours.
          </p>
        </div>
      `,
    }),
  })

  if (!emailRes.ok) {
    const errText = await emailRes.text()
    return res.status(500).json({ error: `Email send failed: ${errText}` })
  }

  res.json({ ok: true })
}
