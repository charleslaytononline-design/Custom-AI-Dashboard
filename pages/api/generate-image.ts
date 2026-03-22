import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const COST_PER_IMAGE = 0.003 // what Replicate charges you
const MARKUP_PER_IMAGE = 0.01 // what you charge the user

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { prompt, userId } = req.body

  if (!userId) return res.status(401).json({ error: 'Not authenticated' })

  // Check credits
  const { data: profile } = await supabase
    .from('profiles')
    .select('credit_balance, role')
    .eq('id', userId)
    .single()

  if (!profile) return res.status(401).json({ error: 'User not found' })

  const isAdmin = profile.role === 'admin'

  if (profile.credit_balance < MARKUP_PER_IMAGE) {
    return res.status(402).json({ error: 'insufficient_credits', message: 'Not enough credits to generate an image.' })
  }

  try {
    // Step 1: Start the prediction
    const startRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-2-pro/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait=60',
      },
      body: JSON.stringify({
        input: {
          prompt: prompt,
          width: 1024,
          height: 768,
          output_format: 'webp',
          output_quality: 90,
          safety_tolerance: 2,
          prompt_upsampling: true,
        }
      })
    })

    const prediction = await startRes.json()

    if (!startRes.ok) {
      throw new Error(prediction.detail || 'Replicate API error')
    }

    // Step 2: Poll for result if not ready
    let imageUrl = prediction.output
    
    if (!imageUrl && prediction.id) {
      // Poll up to 60 seconds
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
          headers: { 'Authorization': `Bearer ${process.env.REPLICATE_API_TOKEN}` }
        })
        const pollData = await pollRes.json()
        if (pollData.status === 'succeeded') {
          imageUrl = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output
          break
        }
        if (pollData.status === 'failed') {
          throw new Error('Image generation failed')
        }
      }
    }

    if (Array.isArray(imageUrl)) imageUrl = imageUrl[0]

    if (!imageUrl) throw new Error('No image URL returned')

    // Step 3: Save to Supabase Storage for permanent hosting
    let permanentUrl = imageUrl
    try {
      const imgRes = await fetch(imageUrl)
      const imgBuffer = await imgRes.arrayBuffer()
      const fileName = `generated/${userId}/${Date.now()}.webp`
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('images')
        .upload(fileName, imgBuffer, {
          contentType: 'image/webp',
          cacheControl: '31536000',
        })

      if (!uploadError && uploadData) {
        const { data: urlData } = supabase.storage
          .from('images')
          .getPublicUrl(fileName)
        permanentUrl = urlData.publicUrl
      }
    } catch (storageErr) {
      // Storage failed - use Replicate URL as fallback (expires in 24h)
      console.log('Storage upload failed, using Replicate URL:', storageErr)
    }

    // Step 4: Deduct credits from everyone including admin
    await supabase.rpc('deduct_credits', {
      p_user_id: userId,
      p_amount: MARKUP_PER_IMAGE,
      p_description: `Image generation: ${prompt.slice(0, 50)}`,
      p_tokens_used: 0,
      p_api_cost: COST_PER_IMAGE,
    })

    // Get updated balance
    const { data: updatedProfile } = await supabase
      .from('profiles').select('credit_balance').eq('id', userId).single()

    res.status(200).json({
      url: permanentUrl,
      newBalance: updatedProfile?.credit_balance || 0,
    })

  } catch (err: any) {
    console.error('Image generation error:', err)
    res.status(500).json({ error: err.message })
  }
}