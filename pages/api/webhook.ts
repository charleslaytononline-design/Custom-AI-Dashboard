import type { NextApiRequest, NextApiResponse } from 'next'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' })

// Use service role key for webhook (bypasses RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const config = { api: { bodyParser: false } }

async function getRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const rawBody = await getRawBody(req)
  const sig = req.headers['stripe-signature']!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return res.status(400).json({ error: 'Invalid webhook signature' })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const { userId, credits } = session.metadata!
    const creditsNum = parseFloat(credits)

    // Add credits to user account
    const { error } = await supabase.rpc('add_credits', {
      p_user_id: userId,
      p_amount: creditsNum,
      p_type: 'purchase',
      p_description: `Purchased $${creditsNum} credits`,
      p_stripe_payment_id: session.payment_intent as string,
    })

    if (error) {
      return res.status(500).json({ error: 'Failed to add credits' })
    }

    // Log the payment event
    await supabase.from('platform_logs').insert({
      event_type: 'payment_success',
      severity: 'info',
      message: `Payment of $${creditsNum} credits completed`,
      email: session.customer_email || null,
      metadata: { userId, credits: creditsNum, payment_intent: session.payment_intent, amount_total: session.amount_total },
    })
  }

  res.status(200).json({ received: true })
}
