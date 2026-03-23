import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })

  // Use admin API to create the user — bypasses Supabase's 3/hour email rate limit
  const { data, error } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: false, // still requires confirmation via link
  })

  if (error) {
    return res.status(400).json({ error: error.message })
  }

  const userId = data.user.id

  // Assign the Free plan to the new user
  const { data: freePlan } = await adminSupabase
    .from('plans')
    .select('id')
    .eq('price_monthly', 0)
    .order('sort_order', { ascending: true })
    .limit(1)
    .single()

  if (freePlan) {
    await adminSupabase.from('profiles').update({ plan_id: freePlan.id }).eq('id', userId)
  }

  // Generate a magic link (confirms email AND signs in when clicked)
  // type 'signup' requires a password; 'magiclink' only needs email
  const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  if (linkError || !linkData?.properties?.action_link) {
    // Can't generate link — auto-confirm so the user isn't permanently stuck
    await adminSupabase.auth.admin.updateUserById(userId, { email_confirm: true })
    return res.json({ ok: true, autoConfirmed: true })
  }

  const confirmUrl = linkData.properties.action_link
  const fromEmail = process.env.ALERT_FROM_EMAIL || 'noreply@resend.dev'

  // Send confirmation email via Resend
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
          <h2 style="font-size:20px;font-weight:600;margin-bottom:8px">Confirm your account</h2>
          <p style="color:#888;font-size:14px;line-height:1.6;margin-bottom:28px">
            Thanks for signing up! Click the button below to confirm your email and sign in to your account.
          </p>
          <a href="${confirmUrl}" style="display:inline-block;padding:13px 28px;background:#7c6ef7;color:white;border-radius:9px;text-decoration:none;font-weight:600;font-size:14px">
            Confirm &amp; Sign In
          </a>
          <p style="color:#555;font-size:12px;margin-top:32px;line-height:1.6">
            If you didn't create an account, you can safely ignore this email.<br>
            This link expires in 1 hour.
          </p>
        </div>
      `,
    }),
  })

  if (!emailRes.ok) {
    // Resend failed — auto-confirm so the user can still get in
    await adminSupabase.auth.admin.updateUserById(userId, { email_confirm: true })
    return res.json({ ok: true, autoConfirmed: true })
  }

  // Log the signup
  await adminSupabase.from('platform_logs').insert({
    event_type: 'signup_success',
    severity: 'info',
    message: `New signup: ${email}`,
    email,
    metadata: { userId, emailSent: true },
  })

  return res.json({ ok: true, autoConfirmed: false })
}
