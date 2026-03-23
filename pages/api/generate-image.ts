import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const COST_PER_IMAGE = 0.003  // what Replicate charges you
const MARKUP_PER_IMAGE = 0.01 // what you charge the user

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
    // Fire email alert if configured
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

const FALLBACK_IMAGE_MODEL = 'black-forest-labs/flux-1.1-pro'

function isSSLError(msg: string) {
  return /ssl|certificate|cert/i.test(msg)
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

  // ── Step 1: Start the Replicate prediction (with SSL-error fallback) ─────
  let startRes!: Response
  let prediction: any
  let usedModel = primaryModel

  async function callReplicate(model: string) {
    return fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
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
  }

  try {
    startRes = await callReplicate(primaryModel)
    prediction = await startRes.json()

    // If primary model failed with SSL/cert error, retry with fallback model
    if (!startRes.ok && primaryModel !== FALLBACK_IMAGE_MODEL) {
      const detail = prediction?.detail || prediction?.error || ''
      if (isSSLError(detail)) {
        await logEvent('builder_error', 'warn', `${primaryModel} SSL error — retrying with ${FALLBACK_IMAGE_MODEL}`, userId, {
          prompt: prompt?.slice(0, 200), originalError: detail,
        })
        usedModel = FALLBACK_IMAGE_MODEL
        startRes = await callReplicate(FALLBACK_IMAGE_MODEL)
        prediction = await startRes.json()
      }
    }
  } catch (fetchErr: any) {
    // Network-level failure on primary — try fallback if different model
    if (primaryModel !== FALLBACK_IMAGE_MODEL && isSSLError(fetchErr.message)) {
      await logEvent('builder_error', 'warn', `${primaryModel} network SSL error — retrying with ${FALLBACK_IMAGE_MODEL}`, userId, {
        prompt: prompt?.slice(0, 200), error: fetchErr.message,
      })
      try {
        usedModel = FALLBACK_IMAGE_MODEL
        startRes = await callReplicate(FALLBACK_IMAGE_MODEL)
        prediction = await startRes.json()
      } catch (fallbackErr: any) {
        await logEvent('builder_error', 'error', `Fallback ${FALLBACK_IMAGE_MODEL} also failed: ${fallbackErr.message}`, userId, {
          prompt: prompt?.slice(0, 200), error: fallbackErr.message,
        })
        return res.status(500).json({ error: 'Image generation failed', detail: fallbackErr.message })
      }
    } else {
      await logEvent('builder_error', 'error', `Replicate fetch failed: ${fetchErr.message}`, userId, {
        prompt: prompt?.slice(0, 200), error: fetchErr.message,
      })
      return res.status(500).json({ error: 'Image generation failed', detail: fetchErr.message })
    }
  }

  if (!startRes!.ok) {
    const detail = prediction?.detail || prediction?.error || JSON.stringify(prediction)
    await logEvent('builder_error', 'error', `Replicate API rejected request (HTTP ${startRes!.status}) [${usedModel}]: ${detail}`, userId, {
      prompt: prompt?.slice(0, 200), model: usedModel, status: startRes!.status, replicateResponse: prediction,
    })
    return res.status(500).json({ error: 'Image generation failed', detail })
  }

  // ── Step 2: Poll for result if not immediately ready ────────────────────
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
        await logEvent('builder_error', 'error', `Replicate poll fetch failed: ${pollErr.message}`, userId, {
          predictionId: prediction.id, attempt: i, error: pollErr.message,
        })
        return res.status(500).json({ error: 'Image generation failed', detail: pollErr.message })
      }

      if (pollData.status === 'succeeded') {
        imageUrl = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output
        break
      }
      if (pollData.status === 'failed') {
        const detail = pollData.error || 'Replicate prediction failed'
        await logEvent('builder_error', 'error', `Replicate prediction failed: ${detail}`, userId, {
          predictionId: prediction.id, prompt: prompt?.slice(0, 200), replicateError: pollData.error,
        })
        return res.status(500).json({ error: 'Image generation failed', detail })
      }
    }
  }

  if (Array.isArray(imageUrl)) imageUrl = imageUrl[0]

  if (!imageUrl) {
    await logEvent('builder_error', 'error', 'Replicate returned no image URL (timed out after 60s)', userId, {
      predictionId: prediction.id, prompt: prompt?.slice(0, 200),
    })
    return res.status(500).json({ error: 'Image generation failed', detail: 'No image URL returned — prediction may have timed out' })
  }

  // ── Step 3: Download and upload to Supabase Storage for permanent URL ───
  let permanentUrl = imageUrl
  try {
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) throw new Error(`Failed to download image from Replicate: HTTP ${imgRes.status}`)
    const imgBuffer = await imgRes.arrayBuffer()
    const fileName = `generated/${userId}/${Date.now()}.webp`

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('images')
      .upload(fileName, imgBuffer, { contentType: 'image/webp', cacheControl: '31536000' })

    if (uploadError) {
      // Log storage failure but fall back to Replicate URL
      await logEvent('builder_error', 'warn', `Supabase storage upload failed — using temporary Replicate URL`, userId, {
        storageError: uploadError.message, fileName,
      })
    } else if (uploadData) {
      const { data: urlData } = supabase.storage.from('images').getPublicUrl(fileName)
      permanentUrl = urlData.publicUrl
    }
  } catch (storageErr: any) {
    await logEvent('builder_error', 'warn', `Storage step threw: ${storageErr.message} — using Replicate URL as fallback`, userId, {
      error: storageErr.message,
    })
    // permanentUrl stays as the Replicate URL
  }

  // ── Step 4: Deduct credits ───────────────────────────────────────────────
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
    newBalance: updatedProfile?.credit_balance || 0,
  })
}
