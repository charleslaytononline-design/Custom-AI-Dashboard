import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FALLBACK_MODEL = 'black-forest-labs/flux-1.1-pro'

async function getImageSettings() {
  const { data } = await supabase.from('settings').select('key, value').in('key', ['image_cost_per_gen', 'markup_multiplier'])
  const map: Record<string, string> = {}
  data?.forEach((s: any) => { map[s.key] = s.value })
  return {
    costPerImage: parseFloat(map['image_cost_per_gen']) || 0.05,
    markupMultiplier: parseFloat(map['markup_multiplier']) || 3.0,
  }
}

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

  const [{ data: profile }, { data: modelSetting }, imageSettings] = await Promise.all([
    supabase.from('profiles').select('credit_balance, gift_balance, role, plan_id').eq('id', userId).single(),
    supabase.from('settings').select('value').eq('key', 'ai_image_model').single(),
    getImageSettings(),
  ])

  const costPerImage = imageSettings.costPerImage
  const chargePerImage = costPerImage * imageSettings.markupMultiplier

  if (!profile) return res.status(401).json({ error: 'User not found' })

  if ((profile.credit_balance + (profile.gift_balance || 0)) < chargePerImage) {
    return res.status(402).json({ error: 'insufficient_credits', message: 'Not enough credits to generate an image.' })
  }

  // ── Storage limit check ────────────────────────────────────────────────
  const userPlanId = (profile as any).plan_id || null
  const { data: storagePlan } = userPlanId
    ? await supabase.from('plans').select('max_storage_mb').eq('id', userPlanId).single()
    : await supabase.from('plans').select('max_storage_mb').eq('price_monthly', 0).order('sort_order', { ascending: true }).limit(1).single()
  if (storagePlan?.max_storage_mb) {
    try {
      const { data: files } = await supabase.storage.from('images').list(`generated/${userId}`, { limit: 10000 })
      const totalBytes = (files || []).reduce((sum, f) => sum + (f.metadata?.size || 0), 0)
      const totalMb = totalBytes / (1024 * 1024)
      if (totalMb >= storagePlan.max_storage_mb) {
        return res.status(200).json({
          error: 'storage_limit_reached',
          message: `Storage limit of ${storagePlan.max_storage_mb} MB reached. Upgrade your plan for more storage.`,
        })
      }
    } catch { /* don't block on storage check errors */ }
  }

  const primaryModel = modelSetting?.value || 'black-forest-labs/flux-2-pro'

  // ── Step 1: Generate image (with automatic fallback on SSL errors) ───────
  let imageUrl: string
  let usedModel = primaryModel

  try {
    imageUrl = await runPrediction(primaryModel, prompt)
  } catch (primaryErr: any) {
    if (primaryErr.isSSL && primaryModel !== FALLBACK_MODEL) {
      // SSL cert failure inside Replicate's infrastructure — wait briefly then retry with flux-1.1-pro
      // The brief pause avoids hitting Replicate's burst rate limit from rapid sequential requests
      await logEvent('builder_error', 'warn',
        `${primaryModel} SSL cert error — auto-retrying with ${FALLBACK_MODEL}`,
        userId, { prompt: prompt?.slice(0, 200), originalError: primaryErr.message }
      )
      await new Promise(r => setTimeout(r, 8000)) // wait 8s to clear burst limit
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
    p_amount: chargePerImage,
    p_description: `Image generation: ${prompt.slice(0, 50)}`,
    p_tokens_used: 0,
    p_api_cost: costPerImage,
  })

  const { data: updatedProfile } = await supabase
    .from('profiles').select('credit_balance, gift_balance').eq('id', userId).single()

  res.status(200).json({
    url: permanentUrl,
    usedModel,
    newBalance: (updatedProfile?.credit_balance || 0) + (updatedProfile?.gift_balance || 0),
  })
}
