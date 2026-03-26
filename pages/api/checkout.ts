import type { NextApiRequest, NextApiResponse } from 'next'
import Stripe from 'stripe'
import { getAuthUser } from '../../lib/apiAuth'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' })

const CREDIT_PACKS = [
  { id: 'pack_5',  amount: 5,  credits: 5,  label: '$5 credits' },
  { id: 'pack_10', amount: 10, credits: 10, label: '$10 credits' },
  { id: 'pack_25', amount: 25, credits: 25, label: '$25 credits' },
  { id: 'pack_50', amount: 50, credits: 50, label: '$50 credits' },
]

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  // Verify server-side session
  const sessionUserId = await getAuthUser(req, res)
  if (!sessionUserId) return res.status(401).json({ error: 'Not authenticated' })

  const { packId, userEmail } = req.body
  const userId = sessionUserId

  const pack = CREDIT_PACKS.find(p => p.id === packId)
  if (!pack) return res.status(400).json({ error: 'Invalid pack' })

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: userEmail,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Custom AI Dashboard — ${pack.label}`,
            description: `$${pack.credits} of AI credits for building apps`,
          },
          unit_amount: pack.amount * 100,
        },
        quantity: 1,
      }],
      metadata: { userId, packId, credits: pack.credits.toString() },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/home?payment=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/home?payment=cancelled`,
    })

    res.status(200).json({ url: session.url })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}