import { createMiddlewareSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that require NO authentication (public)
const PUBLIC_ROUTES = [
  '/',                  // Login page
  '/reset-password',    // Password reset
]

// API routes that are public (webhooks, signup, etc.)
const PUBLIC_API_ROUTES = [
  '/api/signup',
  '/api/forgot-password',
  '/api/webhook',         // Stripe webhook (validates signature internally)
  '/api/cron/',           // Cron jobs (validate CRON_SECRET internally)
  '/api/log',             // Logging (auth is optional, handled internally)
  '/api/preview/',        // Page previews
]

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const { pathname } = req.nextUrl

  // Allow public pages
  if (PUBLIC_ROUTES.includes(pathname)) {
    return res
  }

  // Allow public API routes
  if (PUBLIC_API_ROUTES.some(route => pathname.startsWith(route))) {
    return res
  }

  // Allow static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return res
  }

  // Create authenticated Supabase client
  const supabase = createMiddlewareSupabaseClient({ req, res })
  const { data: { session } } = await supabase.auth.getSession()

  // No session = redirect to login (for pages) or 401 (for API)
  if (!session) {
    if (pathname.startsWith('/api/')) {
      return new NextResponse(
        JSON.stringify({ error: 'Not authenticated' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }
    const loginUrl = new URL('/', req.url)
    return NextResponse.redirect(loginUrl)
  }

  // Skip page access checks for API routes (they handle their own auth)
  if (pathname.startsWith('/api/')) {
    return res
  }

  // Role-based page access enforcement — single RPC call instead of 3 queries
  const basePath = '/' + pathname.split('/').filter(Boolean)[0]
  const { data: access } = await supabase.rpc('check_page_access', {
    p_user_id: session.user.id,
    p_page_path: basePath,
  })

  if (access && !access.allowed) {
    const homeUrl = new URL('/home', req.url)
    return NextResponse.redirect(homeUrl)
  }

  return res
}

export const config = {
  matcher: [
    // Match all routes except static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
