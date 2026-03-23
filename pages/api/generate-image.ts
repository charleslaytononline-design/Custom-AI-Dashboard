import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const COST_PER_IMAGE = 0.003  // what Replicate charges you
const MARKUP_PER_IMAGE = 0.01 // what you charge the user
const FALLBACK_MODEL = 'black-forest-labs/flux-1.1-pro'

async function logEvent(
  event_type: string,
  severity: 'info' | 'warn' | 'error',
  message: string,
  userId?: string,
  metadata?: Record<string, unknown>
) {
  try {
    await supabase.from('platform_logs').insert({
      event_type, severity, message,
      email: null,
      metadata: { userId, ...metadata },
    })
    const { data: setting } = await supabase
      .from('log_alert_settings').select('send_email').eq('event_type', event_type).single()
    if (setting?.send_email && process.env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.ALERT_FROM_EMAIL || 'alerts@resend.dev',
          to: process.env.ALERT_TO_EMAIL || 'charleslayton.online@gmail.com',
          subject: `[Dashboard Alert] ${event_type}`,
          html: `<p><strong>${event_type}</strong> (${severity})</p><p>${message}</p><pre>${JSON.stringify({ userId, ...metadata }, null, 2)}</pre>`,
        }),
      }).catch(() => {})
    }
  } catch { /* never let logging break the response */ }
}

function isSSLError(msg: string) {
  return /ssl|certificate|cert/i.test(msg || '')
}

// Runs a full prediction: start + poll. Returns imageUrl on success, or throws with { message, isSSL }.
async function runPrediction(model: string, prompt: string): Promise<string> {
  // ── Start prediction ────────────────────────────────────────────────────
  let startRes: Response
  try {
    startRes = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait=60',
      },
      body: JSON.stringify({
        input: {
          prompt,
          width: 1024,
          height: 768,
          output_format: 'webp',
          output_quality: 90,
          safety_tolerance: 2,
          prompt_upsampling: true,
        },
      }),
    })
  } catch (err: any) {
    const e = new Error(err.message) as any
    e.isSSL = isSSLError(err.message)
    throw e
  }

  const prediction = await startRes.json()

  if (!startRes.ok) {
    const msg = prediction?.detail || prediction?.error || `HTTP ${startRes.status}`
    const e = new Error(msg) as any
    e.isSSL = isSSLError(msg)
    throw e
  }

  // ── Poll for result ─────────────────────────────────────────────────────
  let imageUrl = prediction.output

  if (!imageUrl && prediction.id) {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      let pollData: any
      try {
        const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
          headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
        })
        pollData = await pollRes.json()
      } catch (pollErr: any) {
        const e = new Error(pollErr.message) as any
        e.isSSL = isSSLError(pollErr.message)
        throw e
      }

      if (pollData.status === 'succeeded') {
        imageUrl = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output
        break
      }
      if (pollData.status === 'failed') {
        const msg = pollData.error || 'Replicate prediction failed'
        const e = new Error(msg) as any
        e.isSSL = isSSLError(msg)
        throw e
      }
    }
  }

  if (Array.isArray(imageUrl)) imageUrl = imageUrl[0]

  if (!imageUrl) {
    const e = new Error('No image URL returned — prediction may have timed out') as any
    e.isSSL = false
    throw e
  }

  return imageUrl
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { prompt, userId } = req.body

  if (!userId) return res.status(401).json({ error: 'Not authenticated' })

  const [{ data: profile }, { data: modelSetting }] = await Promise.all([
    supabase.from('profiles').select('credit_balance, role').eq('id', userId).single(),
    supabase.from('settings').select('value').eq('key', 'ai_image_model').single(),
  ])

  if (!profile) return res.status(401).json({ error: 'User not found' })

  if (profile.credit_balance < MARKUP_PER_IMAGE) {
    return res.status(402).json({ error: 'insufficient_credits', message: 'Not enough credits to generate an image.' })
  }

  const primaryModel = modelSetting?.value || 'black-forest-labs/flux-2-pro'

  // ── Step 1: Generate image (with automatic fallback on SSL errors) ───────
  let imageUrl: string
  let usedModel = primaryModel

  try {
    imageUrl = await runPrediction(primaryModel, prompt)
  } catch (primaryErr: any) {
    if (primaryErr.isSSL && primaryModel !== FALLBACK_MODEL) {
      // SSL cert failure inside Replicate's infrastructure — retry with flux-1.1-pro
      await logEvent('builder_error', 'warn',
        `${primaryModel} SSL cert error — auto-retrying with ${FALLBACK_MODEL}`,
        userId, { prompt: prompt?.slice(0, 200), originalError: primaryErr.message }
      )
      try {
        usedModel = FALLBACK_MODEL
        imageUrl = await runPrediction(FALLBACK_MODEL, prompt)
      } catch (fallbackErr: any) {
        await logEvent('builder_error', 'error',
          `Fallback ${FALLBACK_MODEL} also failed: ${fallbackErr.message}`,
          userId, { prompt: prompt?.slice(0, 200), error: fallbackErr.message }
        )
        return res.status(500).json({ error: 'Image generation failed', detail: fallbackErr.message })
      }
    } else {
      await logEvent('builder_error', 'error',
        `Image generation failed [${primaryModel}]: ${primaryErr.message}`,
        userId, { prompt: prompt?.slice(0, 200), model: primaryModel, error: primaryErr.message }
      )
      return res.status(500).json({ error: 'Image generation failed', detail: primaryErr.message })
    }
  }

  if (usedModel !== primaryModel) {
    await logEvent('builder_error', 'warn',
      `Image generated with fallback model ${usedModel} (primary ${primaryModel} had SSL error)`,
      userId, { prompt: prompt?.slice(0, 200) }
    )
  }

  // ── Step 2: Download and upload to Supabase Storage for permanent URL ───
  let permanentUrl = imageUrl!
  try {
    const imgRes = await fetch(imageUrl!)
    if (!imgRes.ok) throw new Error(`Failed to download image: HTTP ${imgRes.status}`)
    const imgBuffer = await imgRes.arrayBuffer()
    const fileName = `generated/${userId}/${Date.now()}.webp`

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('images')
      .upload(fileName, imgBuffer, { contentType: 'image/webp', cacheControl: '31536000' })

    if (uploadError) {
      await logEvent('builder_error', 'warn', `Supabase storage upload failed — using temporary Replicate URL`, userId, {
        storageError: uploadError.message, fileName,
      })
    } else if (uploadData) {
      const { data: urlData } = supabase.storage.from('images').getPublicUrl(fileName)
      permanentUrl = urlData.publicUrl
    }
  } catch (storageErr: any) {
    await logEvent('builder_error', 'warn', `Storage step threw: ${storageErr.message} — using Replicate URL`, userId, {
      error: storageErr.message,
    })
  }

  // ── Step 3: Deduct credits ───────────────────────────────────────────────
  await supabase.rpc('deduct_credits', {
    p_user_id: userId,
    p_amount: MARKUP_PER_IMAGE,
    p_description: `Image generation: ${prompt.slice(0, 50)}`,
    p_tokens_used: 0,
    p_api_cost: COST_PER_IMAGE,
  })

  const { data: updatedProfile } = await supabase
    .from('profiles').select('credit_balance').eq('id', userId).single()

  res.status(200).json({
    url: permanentUrl,
    usedModel,
    newBalance: updatedProfile?.credit_balance || 0,
  })
}
